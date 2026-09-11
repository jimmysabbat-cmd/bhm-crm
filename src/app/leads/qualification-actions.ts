"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { changeLeadStatus } from "@/lib/leads/status";
import { ensureDraftDossierForLead } from "@/lib/leads/conversion";
import { detectOpportunites, selectMetiersActifs } from "@/lib/opportunites/engine";
import type { OpportunitesInput, OpportunitesResult, FicheMetierCondition } from "@/lib/opportunites/types";
import { buildChampsConnus } from "@/lib/opportunites/champs-connus";
import { selectNextBestQuestion, type NbqQuestion, type NbqResult } from "@/lib/next-best-question/engine";
import { calculateCategorieMenage, type CategorieMenageResult } from "@/lib/reglementaire/menage";
import type { AnswerValue } from "@/lib/questionnaire/engine";
import { mapReponsesToStructuredFields, type MappableAnswer, type ClientFieldUpdate } from "@/lib/questionnaire/mapping";
import type { Prisma } from "@/generated/prisma/client";

// ============================================================
// Actions serveur du parcours de qualification télépro (P14). Isolation
// tenant stricte sur chaque requête (organisationId systématique dans le
// where, jamais un filtrage uniquement côté UI). Ne déclenche jamais un
// envoi email/webhook réel : EMAIL_SEND_ENABLED/AUTOMATIONS_ENABLED
// gouvernent déjà ça ailleurs, ce fichier ne les contourne jamais.
// ============================================================

async function loadOwnedLead(leadId: string, organisationId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId } });
  if (!lead) throw new Error("Lead introuvable.");
  return lead;
}

async function loadFichesMetierActives(organisationId: string): Promise<OpportunitesInput["fichesMetier"]> {
  const fiches = await prisma.ficheMetier.findMany({
    where: { organisationId, actif: true },
    orderBy: { ordre: "asc" },
    include: {
      programmes: { include: { programme: { select: { id: true, code: true, nom: true } } } },
      reglesReglementaires: { include: { regleReglementaire: { select: { id: true, code: true, nom: true } } } },
    },
  });

  return fiches.map((f) => ({
    id: f.id,
    typeTravaux: f.typeTravaux,
    code: f.code,
    libelle: f.libelle,
    actif: f.actif,
    ordre: f.ordre,
    conditionsActivation: (f.conditionsActivation as unknown as FicheMetierCondition[]) ?? [],
    donneesNecessairesEligibilite: (f.donneesNecessairesEligibilite as unknown as string[]) ?? [],
    prochaineAction: f.prochaineAction,
    typeRdvRecommande: f.typeRdvRecommande,
    programmes: f.programmes.map((p) => ({ id: p.programme.id, code: p.programme.code, nom: p.programme.nom })),
    reglesReglementaires: f.reglesReglementaires.map((r) => ({ id: r.regleReglementaire.id, code: r.regleReglementaire.code, nom: r.regleReglementaire.nom })),
  }));
}

async function loadReponsesActuelles(leadId: string): Promise<{ reponses: Record<string, AnswerValue>; questions: NbqQuestion[] }> {
  const reponseQuestionnaire = await prisma.reponseQuestionnaire.findFirst({
    where: { leadId },
    orderBy: { updatedAt: "desc" },
    include: {
      questionnaireVersion: {
        include: {
          questions: { include: { conditionsAffichage: { include: { questionDeclenchante: { select: { code: true } } } } } },
        },
      },
      reponses: true,
    },
  });

  if (!reponseQuestionnaire) return { reponses: {}, questions: [] };

  const reponsesByQuestionId = new Map(reponseQuestionnaire.reponses.map((r) => [r.questionId, r]));
  const reponsesByCode: Record<string, AnswerValue> = {};
  const questions: NbqQuestion[] = reponseQuestionnaire.questionnaireVersion.questions.map((q) => {
    const r = reponsesByQuestionId.get(q.id);
    if (r) {
      reponsesByCode[q.code] = {
        texte: r.valeurTexte,
        nombre: r.valeurNombre,
        bool: r.valeurBool,
        date: r.valeurDate ? r.valeurDate.toISOString() : null,
        options: (r.valeurOptions as string[] | null) ?? null,
      };
    }
    return {
      id: q.id,
      code: q.code,
      type: q.type,
      conditions: q.conditionsAffichage.map((c) => ({ questionDeclenchanteCode: c.questionDeclenchante.code, valeurAttendue: c.valeurAttendue })),
      champMappe: q.champMappe,
      metierConcerne: q.metierConcerne,
      categorieImpact: q.categorieImpact,
      poidsCommercial: q.poidsCommercial,
      obligatoire: q.obligatoire,
      libelle: q.libelle,
    };
  });

  return { reponses: reponsesByCode, questions };
}

/**
 * Champs "Client" au meilleur état connu : le Client persisté s'il existe
 * déjà (lead converti), sinon dérivé EN DIRECT des réponses déjà données
 * (mapReponsesToStructuredFields) - un lead pas encore converti n'a pas de
 * ligne Client où écrire foyer/revenus au fil de l'appel (audit section 3 :
 * ces données "survivent naturellement Lead -> Dossier", elles ne sont
 * matérialisées en base qu'à la conversion, cf. ensureDraftDossierForLead),
 * mais l'estimation de catégorie et la détection d'opportunités doivent
 * néanmoins refléter ce qui vient d'être répondu PENDANT l'appel.
 */
type ClientFieldsCourants = {
  zoneClimatique?: ClientFieldUpdate["zoneClimatique"];
  precarite: ClientFieldUpdate["precarite"] | null;
  typeOccupant?: ClientFieldUpdate["typeOccupant"];
  nombrePersonnesFoyer?: number;
  revenuFiscalReference?: number;
};

async function resolveClientFieldsCourants(leadId: string): Promise<ClientFieldsCourants> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId }, select: { client: true } });
  if (lead?.client) {
    return {
      zoneClimatique: lead.client.zoneClimatique ?? undefined,
      precarite: lead.client.precarite,
      typeOccupant: lead.client.typeOccupant ?? undefined,
      nombrePersonnesFoyer: lead.client.nombrePersonnesFoyer ?? undefined,
      revenuFiscalReference: lead.client.revenuFiscalReference ?? undefined,
    };
  }

  const reponseQuestionnaire = await prisma.reponseQuestionnaire.findFirst({
    where: { leadId },
    orderBy: { updatedAt: "desc" },
    include: { reponses: { include: { question: { select: { code: true, champMappe: true } } } } },
  });
  if (!reponseQuestionnaire) return { precarite: null };

  const mappable: MappableAnswer[] = reponseQuestionnaire.reponses.map((r) => ({
    code: r.question.code,
    champMappe: r.question.champMappe,
    valeurTexte: r.valeurTexte,
    valeurNombre: r.valeurNombre,
    valeurBool: r.valeurBool,
    valeurOptions: (r.valeurOptions as string[] | null) ?? null,
  }));
  const mapping = mapReponsesToStructuredFields(mappable);
  return { ...mapping.client, precarite: mapping.client.precarite ?? null };
}

async function computeOpportunitesForLead(leadId: string, organisationId: string): Promise<OpportunitesResult> {
  const [logement, clientCourant, fichesMetier, { reponses, questions }] = await Promise.all([
    prisma.logement.findUnique({ where: { leadId } }),
    resolveClientFieldsCourants(leadId),
    loadFichesMetierActives(organisationId),
    loadReponsesActuelles(leadId),
  ]);

  const champsConnus = buildChampsConnus({ logement, client: clientCourant });

  return detectOpportunites({
    client: {
      precarite: (clientCourant.precarite as never) ?? null,
      typeOccupant: (clientCourant.typeOccupant as never) ?? null,
      nombrePersonnesFoyer: clientCourant.nombrePersonnesFoyer ?? null,
      revenuFiscalReference: clientCourant.revenuFiscalReference ?? null,
      zoneClimatique: (clientCourant.zoneClimatique as never) ?? null,
    },
    reponses,
    questions: questions.map((q) => ({ code: q.code, type: q.type })),
    champsConnus,
    fichesMetier,
  });
}

/** Phase B/C - calcule et retourne les opportunités détectées pour ce lead. */
export async function calculerOpportunitesPourLead(leadId: string): Promise<{ ok: true; result: OpportunitesResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const result = await computeOpportunitesForLead(leadId, ctx.organisationId);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Next Best Question pour ce lead, compte tenu des opportunités actuellement plausibles. */
export async function getNextBestQuestionPourLead(leadId: string): Promise<{ ok: true; result: NbqResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const [logement, clientCourant, opportunites, { reponses, questions }] = await Promise.all([
      prisma.logement.findUnique({ where: { leadId } }),
      resolveClientFieldsCourants(leadId),
      computeOpportunitesForLead(leadId, ctx.organisationId),
      loadReponsesActuelles(leadId),
    ]);
    const champsConnus = buildChampsConnus({ logement, client: clientCourant });
    const metiersActifs = selectMetiersActifs(opportunites);

    const result = selectNextBestQuestion({ questions, reponses, champsConnus, metiersActifs });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Catégorie de ménage estimée (barème ANAH_REVENUS si publié - sinon message honnête, jamais inventé). */
export async function getCategorieMenagePourLead(leadId: string): Promise<{ ok: true; result: CategorieMenageResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const clientCourant = await resolveClientFieldsCourants(leadId);

    const result = await calculateCategorieMenage({
      dateReference: new Date(),
      inputs: {
        zoneClimatique: (clientCourant.zoneClimatique as string | undefined) ?? null,
        nombrePersonnesFoyer: clientCourant.nombrePersonnesFoyer ?? null,
        revenuFiscalReference: clientCourant.revenuFiscalReference ?? null,
      },
    });

    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

/**
 * Confirmation du RDV depuis le parcours de qualification (audit section
 * R/J) : crée le Rdv (réutilise Rdv existant, préremplie), fait avancer le
 * pipeline lead, et GÈLE opportunitesSnapshot sur la session en cours -
 * jamais recalculé rétroactivement ensuite. N'envoie aucun email/webhook
 * (EMAIL_SEND_ENABLED/AUTOMATIONS_ENABLED restent hors de portée de cette
 * action).
 */
export async function confirmerRdvQualification(leadId: string, formData: FormData): Promise<{ ok: true; rdvId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const date = str(formData, "date");
    if (!date) throw new Error("Date obligatoire.");
    const heure = str(formData, "heure");
    const dateTime = new Date(`${date}T${heure ?? "09:00"}:00`);

    const opportunites = await computeOpportunitesForLead(leadId, ctx.organisationId);

    const rdv = await prisma.rdv.create({
      data: {
        organisationId: ctx.organisationId,
        leadId: lead.id,
        date: dateTime,
        type: (str(formData, "type") as "TELEPHONIQUE" | "VISITE" | "AUTRE" | null) ?? "VISITE",
        commercialId: str(formData, "commercialId") ?? lead.commercialId,
        adresse: str(formData, "adresse") ?? lead.adresse,
        commentaire: str(formData, "commentaire"),
        createdById: ctx.userId,
      },
    });

    const reponseQuestionnaire = await prisma.reponseQuestionnaire.findFirst({ where: { leadId }, orderBy: { updatedAt: "desc" } });
    if (reponseQuestionnaire) {
      await prisma.reponseQuestionnaire.update({
        where: { id: reponseQuestionnaire.id },
        data: {
          statut: "TERMINEE",
          termineeAt: new Date(),
          rdvCreeId: rdv.id,
          opportunitesSnapshot: {
            generatedAt: opportunites.generatedAt.toISOString(),
            opportunites: opportunites.opportunites,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const statutRdvPris = await prisma.leadPipelineStatus.findUnique({ where: { key: "RDV_PRIS" } });
    if (statutRdvPris) {
      await changeLeadStatus({ leadId: lead.id, newStatusId: statutRdvPris.id, userId: ctx.userId });
    }

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Rdv",
      entityId: rdv.id,
      action: "RDV_CREE_DEPUIS_QUALIFICATION",
      metadata: { leadId: lead.id, nbOpportunitesDetectees: opportunites.opportunites.length },
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, rdvId: rdv.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Confirmation EXPLICITE par le commercial des opportunités qui deviennent
 * de vrais DossierPosteTravaux (audit section S : "une opportunité n'est
 * pas encore automatiquement un travaux vendu"). Idempotent : ne crée
 * jamais deux fois le même type sur un dossier.
 */
export async function confirmerOpportunitesEnPostes(
  dossierId: string,
  typesTravaux: string[]
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "RUN_LEAD_STUDY")) throw new Error("Accès refusé.");

    const dossier = await prisma.dossier.findFirst({
      where: { id: dossierId, organisationId: ctx.organisationId },
      include: { postesTravaux: { select: { type: true } } },
    });
    if (!dossier) throw new Error("Dossier introuvable.");

    const typesExistants = new Set(dossier.postesTravaux.map((p) => p.type));
    const aCreer = typesTravaux.filter((t) => !typesExistants.has(t as never));

    for (const type of aCreer) {
      await prisma.dossierPosteTravaux.create({ data: { dossierId: dossier.id, type: type as never } });
    }

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Dossier",
      entityId: dossier.id,
      action: "OPPORTUNITES_CONFIRMEES_EN_POSTES",
      metadata: { typesCrees: aCreer.join(",") },
    });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, created: aCreer.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Convertit le lead en dossier préqualifié (réutilise ensureDraftDossierForLead - zéro ressaisie, idempotent). */
export async function convertirEnDossierPrequalifie(leadId: string): Promise<{ ok: true; dossierId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "RUN_LEAD_STUDY") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const { dossierId } = await ensureDraftDossierForLead(leadId, ctx);
    revalidatePath(`/leads/${leadId}/qualification`);
    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, dossierId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
