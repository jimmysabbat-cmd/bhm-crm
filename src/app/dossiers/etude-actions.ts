"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessDossierStudy } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { runDossierStudy, buildStudyContext, computeStudyInputHash, isStudyStale } from "@/lib/etude/engine";
import { sanitizeStudyResultForRole, type RedactedStudyResult } from "@/lib/etude/redact";
import type { StudyMode, StudyScenario, StudyContext } from "@/lib/etude/types";
import type { Prisma } from "@/generated/prisma/client";

// ============================================================
// Server Actions du moteur d'étude (P8, section 20/21/22/28/29).
//
// runDossierStudy() reste un calcul pur (rien n'est persisté par lui-même -
// cf. engine.ts) : ces actions sont les seuls points où une étude devient
// une écriture en base, avec permission + audit à chaque fois.
// ============================================================

// Round-trip JSON explicite avant stockage en colonne Json : Prisma
// n'accepte pas les objets Date directement dans un champ Json (ils doivent
// déjà être des chaînes ISO). Ce round-trip est aussi ce qui rend
// inputsSnapshot/resultsSnapshot relisibles tels quels plus tard sans aucune
// dépendance à des classes/méthodes.
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function loadOwnedDossierForStudy(dossierId: string, organisationId: string) {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    select: { id: true, createdById: true },
  });
  if (!dossier) throw new Error("Dossier introuvable.");
  return dossier;
}

/**
 * Simule une étude (SIMULATION) sans rien enregistrer (section 20 : une
 * simulation n'est pas nécessairement sauvegardée). Retourne le résultat
 * directement au composant appelant, filtré selon le rôle (section 31).
 */
export async function simulerEtudeDossier(dossierId: string): Promise<{ ok: true; result: RedactedStudyResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const dossier = await loadOwnedDossierForStudy(dossierId, ctx.organisationId);
    if (!hasPermission(ctx, "RUN_STUDY") || !canAccessDossierStudy(ctx, dossier)) {
      throw new Error("Accès refusé : vous ne pouvez pas simuler l'étude de ce dossier.");
    }

    const result = await runDossierStudy({ organisationId: ctx.organisationId, dossierId, mode: "SIMULATION" });
    return { ok: true, result: sanitizeStudyResultForRole(result, ctx) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Enregistre une étude (SIMULATION ou OFFICIEL) - crée TOUJOURS une nouvelle
 * version, ne modifie jamais une ligne existante (section 21/28 : une étude
 * officielle passée reste un historique figé, y compris après un nouveau
 * calcul officiel = "recalcul officiel", tracé distinctement en audit).
 */
export async function enregistrerEtudeDossier(dossierId: string, mode: StudyMode): Promise<{ ok: true; etudeId: string; version: number } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const dossier = await loadOwnedDossierForStudy(dossierId, ctx.organisationId);
    if (!hasPermission(ctx, "SAVE_STUDY") || !canAccessDossierStudy(ctx, dossier)) {
      throw new Error("Accès refusé : l'enregistrement d'une étude est réservé à la direction/l'administratif.");
    }

    const result = await runDossierStudy({ organisationId: ctx.organisationId, dossierId, mode });
    const inputHash = computeStudyInputHash(result.context);

    const dernier = await prisma.etudeDossier.findFirst({
      where: { dossierId },
      orderBy: { version: "desc" },
      select: { version: true, mode: true },
    });
    const version = (dernier?.version ?? 0) + 1;
    const estRecalculOfficiel = mode === "OFFICIEL" && dernier != null && dernier.mode === "OFFICIEL";

    const etude = await prisma.etudeDossier.create({
      data: {
        organisationId: ctx.organisationId,
        dossierId,
        version,
        mode,
        inputsSnapshot: toJson(result.context),
        resultsSnapshot: toJson({ scenarios: result.scenarios, recommendedScenarioLabel: result.recommendedScenarioLabel, generatedAt: result.generatedAt }),
        inputHash,
        recommendedScenarioId: result.recommendedScenarioId,
        createdById: ctx.userId,
      },
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "EtudeDossier",
      entityId: etude.id,
      action: estRecalculOfficiel ? "ETUDE_OFFICIELLE_RECALCULEE" : mode === "OFFICIEL" ? "ETUDE_OFFICIELLE_ENREGISTREE" : "ETUDE_SIMULATION_ENREGISTREE",
      metadata: { dossierId, version, nbScenarios: result.scenarios.length },
    });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, etudeId: etude.id, version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function loadOwnedEtude(etudeId: string, organisationId: string) {
  const etude = await prisma.etudeDossier.findFirst({ where: { id: etudeId, organisationId } });
  if (!etude) throw new Error("Étude introuvable.");
  return etude;
}

// Le contenu de resultsSnapshot est un JSON déjà passé par un round-trip
// JSON.stringify/parse (cf. toJson ci-dessus) : les Date deviennent des
// chaînes ISO. On ne relit que les champs scalaires/tableaux dont on a
// besoin ici, jamais un objet Date directement depuis ce JSON.
function findScenarioInSnapshot(resultsSnapshot: unknown, scenarioId: string): StudyScenario | null {
  const parsed = resultsSnapshot as { scenarios?: StudyScenario[] } | null;
  return parsed?.scenarios?.find((s) => s.id === scenarioId) ?? null;
}

/**
 * Retient un scénario comme "sélectionné" par un humain sur une étude déjà
 * enregistrée (section 15/21) - distinct du recommendedScenarioId calculé
 * par le moteur : ce champ est un pointeur de décision, mutable, jamais une
 * prétention que le moteur aurait désigné LE meilleur scénario.
 */
export async function selectionnerScenarioEtude(etudeId: string, scenarioId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "SAVE_STUDY")) throw new Error("Accès refusé.");

    const etude = await loadOwnedEtude(etudeId, ctx.organisationId);
    const scenario = findScenarioInSnapshot(etude.resultsSnapshot, scenarioId);
    if (!scenario) throw new Error("Scénario introuvable dans cette étude.");

    await prisma.etudeDossier.update({
      where: { id: etude.id },
      data: { selectedScenarioId: scenarioId, selectedAt: new Date(), selectedById: ctx.userId },
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "EtudeDossier",
      entityId: etude.id,
      action: "SCENARIO_SELECTIONNE",
      metadata: { dossierId: etude.dossierId, scenarioId, scenarioTitre: scenario.titre },
    });

    revalidatePath(`/dossiers/${etude.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Applique un scénario au dossier (section 22) : matérialise en base les
 * conséquences réelles d'un scénario déjà calculé/enregistré (calcul
 * réglementaire officiel + mouvement financier CEE + délégataire retenu).
 * IDEMPOTENT (section 22/40) : appliquer deux fois le même scénario ne doit
 * jamais dupliquer de ligne - chaque enregistrement créé porte une marque
 * `ETUDE_SCENARIO:{etudeId}:{scenarioId}` (dans CalculReglementaire.resultat
 * ou MouvementFinancier.origine) recherchée avant toute création.
 */
export async function appliquerScenarioEtude(etudeId: string, scenarioId: string): Promise<{ ok: true; calculCree: boolean; mouvementCree: boolean } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "APPLY_STUDY")) throw new Error("Accès refusé : l'application d'un scénario est réservée à la direction/l'administratif.");

    const etude = await loadOwnedEtude(etudeId, ctx.organisationId);
    const scenario = findScenarioInSnapshot(etude.resultsSnapshot, scenarioId);
    if (!scenario) throw new Error("Scénario introuvable dans cette étude.");

    const sourceTag = `ETUDE_SCENARIO:${etude.id}:${scenarioId}`;
    const contextSnapshot = etude.inputsSnapshot as unknown as StudyContext;
    const dateEngagementValue = contextSnapshot?.project?.dateEngagement?.value as unknown as string | null;
    const dateEngagement = dateEngagementValue ? new Date(dateEngagementValue) : new Date();

    let calculCree = false;
    let mouvementCree = false;

    const posteId = scenario.posteIds[0] ?? null;
    const fiche = scenario.fichesReglementaires[0] ?? null;

    if (posteId && fiche && scenario.ceeKwhCumac != null) {
      const posteExistant = await prisma.dossierPosteTravaux.findFirst({ where: { id: posteId, dossierId: etude.dossierId } });
      if (!posteExistant) throw new Error("Poste de travaux introuvable pour ce scénario (dossier modifié depuis l'étude).");

      const calculsExistants = await prisma.calculReglementaire.findMany({
        where: { organisationId: ctx.organisationId, posteTravauxId: posteId },
        select: { id: true, resultat: true },
      });
      const calculExistant = calculsExistants.find((c) => (c.resultat as { sourceId?: string } | null)?.sourceId === sourceTag);

      const regInputs = contextSnapshot?.regulatoryInputs?.find((r) => r.posteId === posteId)?.inputs ?? {};

      const calcul =
        calculExistant ??
        (await prisma.calculReglementaire.create({
          data: {
            organisationId: ctx.organisationId,
            dossierId: etude.dossierId,
            posteTravauxId: posteId,
            ruleVersionId: fiche.ruleVersionId,
            type: "OFFICIEL",
            dateEngagement,
            inputs: toJson(regInputs),
            resultat: toJson({ sourceType: "ETUDE_SCENARIO", sourceId: sourceTag, provenance: fiche.provenance }),
            kwhCumac: scenario.ceeKwhCumac,
            statutEligibilite: scenario.statutEligibilite ?? "A_CONFIRMER",
            createdById: ctx.userId,
          },
        }));
      if (!calculExistant) calculCree = true;

      await prisma.dossierPosteTravaux.update({
        where: { id: posteId },
        data: { ficheReglementaireCode: fiche.ficheCode, calculReglementaireActifId: calcul.id },
      });
    }

    if (scenario.delegataireId) {
      await prisma.dossier.update({ where: { id: etude.dossierId }, data: { delegataireCeeId: scenario.delegataireId } });
    }

    if (scenario.valorisationCeeCts != null && scenario.valorisationCeeCts > 0) {
      const mouvementTag = `${sourceTag}:CEE`;
      const mouvementExistant = await prisma.mouvementFinancier.findFirst({
        where: { organisationId: ctx.organisationId, dossierId: etude.dossierId, origine: mouvementTag },
      });
      if (!mouvementExistant) {
        const datePrevueValue = scenario.delaiEncaissement?.dateEstimee as unknown as string | null;
        await prisma.mouvementFinancier.create({
          data: {
            organisationId: ctx.organisationId,
            dossierId: etude.dossierId,
            type: "ENTREE",
            categorie: "ENCAISSEMENT_CEE",
            payeur: scenario.delegataireNom,
            payeurType: "CEE",
            montantPrevuCts: scenario.valorisationCeeCts,
            datePrevue: datePrevueValue ? new Date(datePrevueValue) : null,
            statut: "A_RECEVOIR",
            origine: mouvementTag,
            commentaire: `Créé depuis l'étude/scénario "${scenario.titre}".`,
            createdById: ctx.userId,
          },
        });
        mouvementCree = true;
      }
    }

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "EtudeDossier",
      entityId: etude.id,
      action: "SCENARIO_APPLIQUE",
      metadata: { dossierId: etude.dossierId, scenarioId, calculCree, mouvementCree },
    });

    revalidatePath(`/dossiers/${etude.dossierId}`);
    return { ok: true, calculCree, mouvementCree };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Trace en audit qu'un utilisateur a pris connaissance qu'une étude
 * enregistrée est devenue obsolète (section 28/29) - l'étude elle-même
 * n'est ni supprimée ni modifiée, seule la reconnaissance est journalisée.
 */
export async function reconnaitreEtudeObsolete(etudeId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VIEW_STUDY")) throw new Error("Accès refusé.");

    const etude = await loadOwnedEtude(etudeId, ctx.organisationId);
    const currentContext = await buildStudyContext(etude.dossierId, ctx.organisationId);
    if (!isStudyStale(etude, currentContext)) {
      throw new Error("Cette étude n'est pas obsolète : les données critiques n'ont pas changé depuis.");
    }

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "EtudeDossier",
      entityId: etude.id,
      action: "ETUDE_OBSOLETE_RECONNUE",
      metadata: { dossierId: etude.dossierId, version: etude.version },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
