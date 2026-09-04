import { prisma } from "@/lib/prisma";
import { calculerDelaiEtape } from "@/lib/workflow";
import { calculateBlockedAmountForDossier, mouvementIsLate, mouvementJoursRetard } from "@/lib/finance";
import { calculateCeeValuation } from "@/lib/reglementaire/valuation";
import { buildStudyContext, isStudyStale } from "@/lib/etude/engine";
import { typeDocumentLabels, categorieMouvementLabels } from "@/lib/dossier-labels";
import type { Role, Precarite } from "@/generated/prisma/enums";

function categorieCeeFromPrecarite(precarite: Precarite | null): "TRES_MODESTE" | "CLASSIQUE" {
  return precarite === "TRES_MODESTE" ? "TRES_MODESTE" : "CLASSIQUE";
}

export const roleLabels: Record<string, string> = {
  ADMIN: "Direction",
  COMMERCIAL: "Commercial",
  COMPTA: "Comptabilité",
  ADMINISTRATIF: "Administratif",
  REGIE: "Régie",
  SOUS_TRAITANT: "Sous-traitant",
  COMPTABILITE: "Comptabilité",
  TECHNIQUE: "Technique",
  TELEPROSPECTEUR: "Téléprospection",
};

export type NiveauUrgence = "BASSE" | "NORMALE" | "HAUTE" | "CRITIQUE";
export type TypeNextBestAction = "ETAPE" | "TACHE" | "MOUVEMENT_FINANCIER" | "DOCUMENT_MANQUANT" | "REGLEMENTAIRE_CEE" | "ETUDE_SCENARIO" | "LEAD";

export type NextBestAction = {
  id: string;
  /** id brut de l'enregistrement source (DossierEtape/Tache/MouvementFinancier/Lead) pour les actions rapides. */
  sourceId: string;
  organisationId: string;
  // P9 : une action LEAD pré-conversion n'a pas encore de dossier -
  // dossierId reste alors null (jamais une chaîne vide qui pourrait être
  // confondue avec un id réel).
  dossierId: string | null;
  client: string;
  referenceDossier: string;
  typeAction: TypeNextBestAction;
  titre: string;
  description: string | null;
  origine: string;
  statut: string;
  responsableUserId: string | null;
  responsableRole: Role | null;
  responsableLabel: string;
  dateCreation: Date;
  dateEcheance: Date | null;
  joursRetard: number;
  niveauUrgence: NiveauUrgence;
  montantBloqueCts: number;
  raisonMontantBloque: string | null;
  route: string;
  reasons: string[];
  priorityScore: number;
  flux: string | null;
  /** Tâche de relance liée (regleRelanceId non null), si une existe pour cette étape. */
  tacheRelanceId: string | null;
  nombreRelances: number;
  /** ENTREE/SORTIE pour les actions MOUVEMENT_FINANCIER (permet de proposer "Marquer reçu" ou "Marquer payé"). */
  mouvementType: "ENTREE" | "SORTIE" | null;
};

export type NextBestActionContext = {
  organisationId: string;
  scope: "all" | "mine";
  userId?: string;
  role?: Role;
};

function niveauFromScore(score: number): NiveauUrgence {
  if (score >= 80) return "CRITIQUE";
  if (score >= 50) return "HAUTE";
  if (score >= 20) return "NORMALE";
  return "BASSE";
}

// Score déterministe et explicable - jamais de ML. Chaque composante est
// documentée dans `reasons` pour que l'utilisateur comprenne pourquoi une
// action est prioritaire.
function score(params: {
  joursRetard: number;
  montantBloqueCts: number;
  bloque: boolean;
  documentManquant: boolean;
  typeAction: TypeNextBestAction;
  delaiAlerteDepasse: boolean;
}): { total: number; reasons: string[] } {
  const reasons: string[] = [];
  let total = 0;

  if (params.joursRetard > 0) {
    const retardScore = Math.min(params.joursRetard * 5, 100);
    total += retardScore;
    reasons.push(`Échéance dépassée de ${params.joursRetard} jour${params.joursRetard > 1 ? "s" : ""}`);
  }

  if (params.montantBloqueCts > 0) {
    const montantEuros = params.montantBloqueCts / 100;
    const moneyScore = Math.min(Math.floor(montantEuros / 100), 50);
    total += moneyScore;
    reasons.push(
      `${montantEuros.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} potentiellement bloqués`
    );
  }

  if (params.bloque) {
    total += 40;
    reasons.push("Étape bloquée");
  }

  if (params.documentManquant) {
    total += 15;
    reasons.push("Document obligatoire manquant");
  }

  if (params.delaiAlerteDepasse) {
    total += 20;
    reasons.push("Délai d'alerte dépassé");
  }

  const urgencyBase: Record<TypeNextBestAction, number> = {
    ETAPE: 10,
    TACHE: 5,
    MOUVEMENT_FINANCIER: 8,
    DOCUMENT_MANQUANT: 12,
    REGLEMENTAIRE_CEE: 10,
    ETUDE_SCENARIO: 8,
    LEAD: 8,
  };
  total += urgencyBase[params.typeAction];

  return { total, reasons };
}

function matchesScope(
  ctx: NextBestActionContext,
  responsableUserId: string | null,
  responsableRole: Role | null
): boolean {
  if (ctx.scope === "all") return true;
  if (!ctx.userId) return false;
  if (responsableUserId) return responsableUserId === ctx.userId;
  if (responsableRole && ctx.role) return responsableRole === ctx.role;
  // Ni utilisateur ni rôle définis : visible uniquement en vue globale.
  return false;
}

/**
 * Dérive la liste des Next Best Actions d'une organisation depuis les
 * vraies données (DossierEtape, Tache, MouvementFinancier, documents
 * requis) - aucune table de copie. Triée par priorité décroissante puis
 * échéance croissante.
 */
export async function getNextBestActions(ctx: NextBestActionContext): Promise<NextBestAction[]> {
  const actions: NextBestAction[] = [];

  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: ctx.organisationId, statut: { key: { not: "CLOTURE" } } },
    select: {
      id: true,
      reference: true,
      client: { select: { prenom: true, nom: true, precarite: true } },
      documents: { select: { type: true } },
      delegataireCeeId: true,
      dossierEtapes: {
        where: { statut: { in: ["A_FAIRE", "EN_COURS", "BLOQUE"] } },
        include: {
          etapeProgramme: { include: { documentsRequis: true } },
          assignedUser: { select: { id: true, name: true } },
          taches: { where: { regleRelanceId: { not: null } } },
        },
      },
      taches: {
        where: { statut: "A_FAIRE", dossierEtapeId: null },
        include: { assigneA: { select: { id: true, name: true } } },
      },
      mouvementsFinanciers: { where: { statut: { notIn: ["RECU", "PAYE", "ANNULE"] } } },
      postesTravaux: {
        where: { ficheReglementaireCode: { not: null } },
        select: {
          id: true,
          type: true,
          ficheReglementaireCode: true,
          createdAt: true,
          calculReglementaireActif: { select: { statutEligibilite: true, kwhCumac: true, overrideStatutEligibilite: true } },
        },
      },
      etudesDossier: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, version: true, mode: true, inputHash: true, createdAt: true },
      },
    },
  });

  const montantBloqueParDossier = new Map<string, Awaited<ReturnType<typeof calculateBlockedAmountForDossier>>>();
  async function montantBloque(dossierId: string) {
    if (!montantBloqueParDossier.has(dossierId)) {
      montantBloqueParDossier.set(dossierId, await calculateBlockedAmountForDossier(dossierId));
    }
    return montantBloqueParDossier.get(dossierId)!;
  }

  for (const dossier of dossiers) {
    const clientLabel = `${dossier.client.prenom} ${dossier.client.nom}`;
    const route = `/dossiers/${dossier.id}`;
    const { montantBloqueCts, details } = await montantBloque(dossier.id);
    const raisonMontant = details.length > 0 ? details.map((d) => d.origine).join(", ") : null;

    // --- DossierEtape actives ---
    for (const de of dossier.dossierEtapes) {
      const delais = calculerDelaiEtape(de);
      const delaiAlerteDepasse =
        de.etapeProgramme.delaiAlerteJours != null &&
        delais.joursEcoules != null &&
        delais.joursEcoules >= de.etapeProgramme.delaiAlerteJours;

      const responsableUserId = de.assignedUserId;
      const responsableRole = de.etapeProgramme.roleResponsable;
      if (!matchesScope(ctx, responsableUserId, responsableRole)) continue;

      const { total, reasons } = score({
        joursRetard: delais.joursRetard,
        montantBloqueCts,
        bloque: de.statut === "BLOQUE",
        documentManquant: false,
        typeAction: "ETAPE",
        delaiAlerteDepasse,
      });
      if (de.statut === "BLOQUE" && de.raisonBlocage) {
        reasons.push(`Blocage : ${de.raisonBlocage}`);
      }
      const tacheRelance = de.taches[0] ?? null;
      if (tacheRelance && tacheRelance.nombreRelances > 0) {
        reasons.push(`${tacheRelance.nombreRelances} relance(s) déjà effectuée(s)`);
      }

      actions.push({
        id: `etape:${de.id}`,
        sourceId: de.id,
        organisationId: ctx.organisationId,
        dossierId: dossier.id,
        client: clientLabel,
        referenceDossier: dossier.reference,
        typeAction: "ETAPE",
        titre: de.statut === "BLOQUE" ? `Bloqué : ${de.etapeProgramme.nom}` : de.etapeProgramme.nom,
        description: de.commentaire,
        origine: `DossierEtape:${de.statut}`,
        statut: de.statut,
        responsableUserId,
        responsableRole,
        responsableLabel: de.assignedUser?.name ?? (responsableRole ? roleLabels[responsableRole] : "Non assigné"),
        dateCreation: de.createdAt,
        dateEcheance: de.dateEcheance,
        joursRetard: delais.joursRetard,
        niveauUrgence: niveauFromScore(total),
        montantBloqueCts,
        raisonMontantBloque: raisonMontant,
        route,
        reasons,
        priorityScore: total,
        flux: de.etapeProgramme.typeFlux,
        tacheRelanceId: tacheRelance?.id ?? null,
        nombreRelances: tacheRelance?.nombreRelances ?? 0,
        mouvementType: null,
      });

      // --- Documents obligatoires manquants pour cette étape ---
      const typesPresents = new Set(dossier.documents.map((d) => d.type));
      for (const docRequis of de.etapeProgramme.documentsRequis) {
        if (!docRequis.obligatoire) continue;
        if (typesPresents.has(docRequis.typeDocument)) continue;

        const { total: docTotal, reasons: docReasons } = score({
          joursRetard: delais.joursRetard,
          montantBloqueCts,
          bloque: false,
          documentManquant: true,
          typeAction: "DOCUMENT_MANQUANT",
          delaiAlerteDepasse: false,
        });
        docReasons.unshift(`${typeDocumentLabels[docRequis.typeDocument]} manquant`);

        actions.push({
          id: `doc:${de.id}:${docRequis.typeDocument}`,
          sourceId: de.id,
          organisationId: ctx.organisationId,
          dossierId: dossier.id,
          client: clientLabel,
          referenceDossier: dossier.reference,
          typeAction: "DOCUMENT_MANQUANT",
          titre: `${typeDocumentLabels[docRequis.typeDocument]} manquant`,
          description: `Requis pour l'étape "${de.etapeProgramme.nom}"`,
          origine: "EtapeDocumentRequis",
          statut: "MANQUANT",
          responsableUserId,
          responsableRole,
          responsableLabel: de.assignedUser?.name ?? (responsableRole ? roleLabels[responsableRole] : "Non assigné"),
          dateCreation: de.createdAt,
          dateEcheance: de.dateEcheance,
          joursRetard: delais.joursRetard,
          niveauUrgence: niveauFromScore(docTotal),
          montantBloqueCts,
          raisonMontantBloque: raisonMontant,
          route,
          reasons: docReasons,
          priorityScore: docTotal,
          flux: de.etapeProgramme.typeFlux,
          tacheRelanceId: null,
          nombreRelances: 0,
          mouvementType: null,
        });
      }
    }

    // --- Tâches manuelles (hors workflow) ---
    for (const t of dossier.taches) {
      const responsableUserId = t.assigneAId;
      if (!matchesScope(ctx, responsableUserId, null)) continue;

      const enRetard = t.dateEcheance.getTime() < Date.now();
      const joursRetard = enRetard ? Math.floor((Date.now() - t.dateEcheance.getTime()) / 86_400_000) : 0;

      const { total, reasons } = score({
        joursRetard,
        montantBloqueCts,
        bloque: false,
        documentManquant: false,
        typeAction: "TACHE",
        delaiAlerteDepasse: false,
      });
      if (t.nombreRelances > 0) reasons.push(`${t.nombreRelances} relance(s) déjà effectuée(s)`);

      actions.push({
        id: `tache:${t.id}`,
        sourceId: t.id,
        organisationId: ctx.organisationId,
        dossierId: dossier.id,
        client: clientLabel,
        referenceDossier: dossier.reference,
        typeAction: "TACHE",
        titre: t.titre,
        description: t.description,
        origine: "Tache",
        statut: t.statut,
        responsableUserId,
        responsableRole: null,
        responsableLabel: t.assigneA?.name ?? "Non assigné",
        dateCreation: t.createdAt,
        dateEcheance: t.dateEcheance,
        joursRetard,
        niveauUrgence: niveauFromScore(total),
        montantBloqueCts,
        raisonMontantBloque: raisonMontant,
        route,
        reasons,
        priorityScore: total,
        flux: null,
        tacheRelanceId: t.regleRelanceId ? t.id : null,
        nombreRelances: t.nombreRelances,
        mouvementType: null,
      });
    }

    // --- Mouvements financiers non soldés ---
    for (const m of dossier.mouvementsFinanciers) {
      if (!matchesScope(ctx, null, "COMPTABILITE" as Role)) continue;

      const late = mouvementIsLate(m);
      const joursRetard = mouvementJoursRetard(m);
      const montant = m.montantReelCts ?? m.montantPrevuCts ?? 0;

      // P6 section 24 : remonter aussi les mouvements devenus exigibles
      // (créance client, CEE/ANAH attendus, fournisseur/sous-traitant/
      // commission à payer) même avant qu'ils ne soient en retard - pas
      // uniquement les mouvements déjà en retard, pour que "sous-traitant
      // exigible" / "commission exigible" remontent au bon moment.
      const estExigible = ["A_PAYER", "A_RECEVOIR", "PARTIEL", "LITIGE", "BLOQUE"].includes(m.statut);
      if (!late && !estExigible) continue;

      const { total, reasons } = score({
        joursRetard,
        montantBloqueCts: montant,
        bloque: m.statut === "BLOQUE",
        documentManquant: false,
        typeAction: "MOUVEMENT_FINANCIER",
        delaiAlerteDepasse: false,
      });
      if (m.statut === "LITIGE") reasons.push("Mouvement en litige");

      const suffixe = late
        ? "en retard"
        : m.statut === "LITIGE"
          ? "en litige"
          : m.statut === "BLOQUE"
            ? "bloqué"
            : m.type === "ENTREE"
              ? "à recevoir"
              : "à payer";

      actions.push({
        id: `mouvement:${m.id}`,
        sourceId: m.id,
        organisationId: ctx.organisationId,
        dossierId: dossier.id,
        client: clientLabel,
        referenceDossier: dossier.reference,
        typeAction: "MOUVEMENT_FINANCIER",
        titre: `${categorieMouvementLabels[m.categorie]} ${suffixe}`,
        description: m.commentaire,
        origine: "MouvementFinancier",
        statut: m.statut,
        responsableUserId: null,
        responsableRole: "COMPTABILITE" as Role,
        responsableLabel: roleLabels.COMPTABILITE,
        dateCreation: m.createdAt,
        dateEcheance: m.datePrevue,
        joursRetard,
        niveauUrgence: niveauFromScore(total),
        montantBloqueCts: montant,
        raisonMontantBloque: m.datePrevue
          ? `${categorieMouvementLabels[m.categorie]} prévu le ${m.datePrevue.toLocaleDateString("fr-FR")}`
          : `${categorieMouvementLabels[m.categorie]} sans date prévue`,
        route,
        reasons,
        priorityScore: total,
        flux: "FINANCIER",
        tacheRelanceId: null,
        nombreRelances: 0,
        mouvementType: m.type,
      });
    }

    // --- Réglementaire CEE (P7, section 27) - uniquement pour les postes
    // déjà rattachés à une fiche réglementaire (ficheReglementaireCode
    // renseigné) : on ne remonte jamais d'action sur un poste qui n'a
    // jamais utilisé le nouveau moteur, faute d'information fiable.
    for (const poste of dossier.postesTravaux) {
      if (!matchesScope(ctx, null, "ADMINISTRATIF" as Role)) continue;
      const calcul = poste.calculReglementaireActif;
      if (!calcul) continue;
      const statutEffectif = calcul.overrideStatutEligibilite ?? calcul.statutEligibilite;

      if (statutEffectif === "DONNEES_INSUFFISANTES" || statutEffectif === "A_CONFIRMER") {
        const { total, reasons: scoreReasons } = score({
          joursRetard: 0,
          montantBloqueCts: 0,
          bloque: false,
          documentManquant: false,
          typeAction: "REGLEMENTAIRE_CEE",
          delaiAlerteDepasse: false,
        });
        scoreReasons.push(
          statutEffectif === "DONNEES_INSUFFISANTES"
            ? "Données CEE manquantes pour confirmer l'éligibilité"
            : "Fiche CEE à confirmer (validation documentaire/qualification requise)"
        );
        actions.push({
          id: `reglementaire:${poste.id}:donnees`,
          sourceId: poste.id,
          organisationId: ctx.organisationId,
          dossierId: dossier.id,
          client: clientLabel,
          referenceDossier: dossier.reference,
          typeAction: "REGLEMENTAIRE_CEE",
          titre: `${poste.ficheReglementaireCode} : ${statutEffectif === "DONNEES_INSUFFISANTES" ? "données manquantes" : "à confirmer"}`,
          description: null,
          origine: "CalculReglementaire",
          statut: statutEffectif,
          responsableUserId: null,
          responsableRole: "ADMINISTRATIF" as Role,
          responsableLabel: roleLabels.ADMINISTRATIF,
          dateCreation: poste.createdAt,
          dateEcheance: null,
          joursRetard: 0,
          niveauUrgence: niveauFromScore(total),
          montantBloqueCts: 0,
          raisonMontantBloque: null,
          route,
          reasons: scoreReasons,
          priorityScore: total,
          flux: "CEE",
          tacheRelanceId: null,
          nombreRelances: 0,
          mouvementType: null,
        });
        continue;
      }

      if (calcul.kwhCumac != null && calcul.kwhCumac > 0) {
        if (!dossier.delegataireCeeId) {
          const { total, reasons: scoreReasons } = score({
            joursRetard: 0,
            montantBloqueCts: 0,
            bloque: false,
            documentManquant: false,
            typeAction: "REGLEMENTAIRE_CEE",
            delaiAlerteDepasse: false,
          });
          scoreReasons.push(`${poste.ficheReglementaireCode} : cumac calculé mais aucun délégataire CEE choisi sur le dossier`);
          actions.push({
            id: `reglementaire:${poste.id}:delegataire`,
            sourceId: poste.id,
            organisationId: ctx.organisationId,
            dossierId: dossier.id,
            client: clientLabel,
            referenceDossier: dossier.reference,
            typeAction: "REGLEMENTAIRE_CEE",
            titre: `${poste.ficheReglementaireCode} : aucun délégataire configuré`,
            description: null,
            origine: "CalculReglementaire",
            statut: statutEffectif,
            responsableUserId: null,
            responsableRole: "ADMINISTRATIF" as Role,
            responsableLabel: roleLabels.ADMINISTRATIF,
            dateCreation: poste.createdAt,
            dateEcheance: null,
            joursRetard: 0,
            niveauUrgence: niveauFromScore(total),
            montantBloqueCts: 0,
            raisonMontantBloque: null,
            route,
            reasons: scoreReasons,
            priorityScore: total,
            flux: "CEE",
            tacheRelanceId: null,
            nombreRelances: 0,
            mouvementType: null,
          });
        } else {
          const valuation = await calculateCeeValuation({
            organisationId: ctx.organisationId,
            kwhCumac: calcul.kwhCumac,
            delegataireId: dossier.delegataireCeeId,
            ficheCode: poste.ficheReglementaireCode!,
            categorie: categorieCeeFromPrecarite(dossier.client.precarite),
            date: new Date(),
          });
          if (!valuation) {
            const { total, reasons: scoreReasons } = score({
              joursRetard: 0,
              montantBloqueCts: 0,
              bloque: false,
              documentManquant: false,
              typeAction: "REGLEMENTAIRE_CEE",
              delaiAlerteDepasse: false,
            });
            scoreReasons.push(`${poste.ficheReglementaireCode} : cumac calculé mais aucun tarif délégataire applicable (non valorisé)`);
            actions.push({
              id: `reglementaire:${poste.id}:valorisation`,
              sourceId: poste.id,
              organisationId: ctx.organisationId,
              dossierId: dossier.id,
              client: clientLabel,
              referenceDossier: dossier.reference,
              typeAction: "REGLEMENTAIRE_CEE",
              titre: `${poste.ficheReglementaireCode} : CEE calculé mais non valorisé`,
              description: null,
              origine: "CalculReglementaire",
              statut: statutEffectif,
              responsableUserId: null,
              responsableRole: "ADMINISTRATIF" as Role,
              responsableLabel: roleLabels.ADMINISTRATIF,
              dateCreation: poste.createdAt,
              dateEcheance: null,
              joursRetard: 0,
              niveauUrgence: niveauFromScore(total),
              montantBloqueCts: 0,
              raisonMontantBloque: null,
              route,
              reasons: scoreReasons,
              priorityScore: total,
              flux: "CEE",
              tacheRelanceId: null,
              nombreRelances: 0,
              mouvementType: null,
            });
          }
        }
      }
    }

    // --- Étude obsolète (P8, section 30) - uniquement si une étude a déjà
    // été enregistrée pour ce dossier : un dossier jamais étudié n'est PAS
    // une anomalie, on ne remonte donc rien dans ce cas. Ne duplique pas les
    // actions REGLEMENTAIRE_CEE ci-dessus (qui portent sur un poste/calcul
    // CEE précis) : celle-ci porte sur l'étude/scénario dans son ensemble,
    // recalculée via le même isStudyStale() que reconnaitreEtudeObsolete().
    const derniereEtude = dossier.etudesDossier[0];
    if (derniereEtude && matchesScope(ctx, null, "ADMINISTRATIF" as Role)) {
      const etudeContext = await buildStudyContext(dossier.id, ctx.organisationId);
      if (isStudyStale(derniereEtude, etudeContext)) {
        const { total, reasons: scoreReasons } = score({
          joursRetard: 0,
          montantBloqueCts: 0,
          bloque: false,
          documentManquant: false,
          typeAction: "ETUDE_SCENARIO",
          delaiAlerteDepasse: false,
        });
        scoreReasons.push(`Étude v${derniereEtude.version} (${derniereEtude.mode}) obsolète : des données du dossier ont changé depuis l'enregistrement.`);
        actions.push({
          id: `etude:${derniereEtude.id}:obsolete`,
          sourceId: derniereEtude.id,
          organisationId: ctx.organisationId,
          dossierId: dossier.id,
          client: clientLabel,
          referenceDossier: dossier.reference,
          typeAction: "ETUDE_SCENARIO",
          titre: "Étude à recalculer",
          description: null,
          origine: "EtudeDossier",
          statut: "OBSOLETE",
          responsableUserId: null,
          responsableRole: "ADMINISTRATIF" as Role,
          responsableLabel: roleLabels.ADMINISTRATIF,
          dateCreation: derniereEtude.createdAt,
          dateEcheance: null,
          joursRetard: 0,
          niveauUrgence: niveauFromScore(total),
          montantBloqueCts: 0,
          raisonMontantBloque: null,
          route,
          reasons: scoreReasons,
          priorityScore: total,
          flux: "ETUDE",
          tacheRelanceId: null,
          nombreRelances: 0,
          mouvementType: null,
        });
      }
    }
  }

  // --- Leads (P9, section 31) - file distincte des dossiers ci-dessus,
  // même moteur (getNextBestActions), jamais une deuxième queue. Un lead
  // déjà converti (dossierId renseigné) peut encore remonter une action
  // "devis à relancer"/"étude à lancer" tant qu'il n'est ni SIGNE ni PERDU.
  const now = new Date();
  const leads = await prisma.lead.findMany({
    where: { organisationId: ctx.organisationId, statut: { key: { notIn: ["SIGNE", "PERDU"] } } },
    select: {
      id: true,
      prenom: true,
      nom: true,
      statut: { select: { key: true, label: true } },
      prochainContactAt: true,
      commercialId: true,
      teleprospecteurId: true,
      createdAt: true,
      dossierId: true,
      dossier: { select: { reference: true } },
      _count: { select: { interactions: true } },
    },
  });

  for (const lead of leads) {
    const responsableUserId = lead.teleprospecteurId ?? lead.commercialId;
    if (!matchesScope(ctx, responsableUserId, null)) continue;

    const clientLabel = `${lead.prenom} ${lead.nom}`;
    const route = `/leads/${lead.id}/qualification`;
    const referenceDossier = lead.dossier?.reference ?? "(non converti)";

    function pushLeadAction(suffix: string, titre: string, reasons: string[], scoreTotal: number) {
      actions.push({
        id: `lead:${lead.id}:${suffix}`,
        sourceId: lead.id,
        organisationId: ctx.organisationId,
        dossierId: lead.dossierId,
        client: clientLabel,
        referenceDossier,
        typeAction: "LEAD",
        titre,
        description: null,
        origine: "Lead",
        statut: lead.statut.key,
        responsableUserId,
        responsableRole: null,
        responsableLabel: "Commercial/téléprospection",
        dateCreation: lead.createdAt,
        dateEcheance: lead.prochainContactAt,
        joursRetard: lead.prochainContactAt && lead.prochainContactAt < now ? Math.floor((now.getTime() - lead.prochainContactAt.getTime()) / 86_400_000) : 0,
        niveauUrgence: niveauFromScore(scoreTotal),
        montantBloqueCts: 0,
        raisonMontantBloque: null,
        route,
        reasons,
        priorityScore: scoreTotal,
        flux: "LEAD",
        tacheRelanceId: null,
        nombreRelances: 0,
        mouvementType: null,
      });
    }

    if (lead.prochainContactAt && lead.prochainContactAt <= now) {
      const joursRetard = Math.max(0, Math.floor((now.getTime() - lead.prochainContactAt.getTime()) / 86_400_000));
      const { total, reasons } = score({ joursRetard, montantBloqueCts: 0, bloque: false, documentManquant: false, typeAction: "LEAD", delaiAlerteDepasse: false });
      reasons.push(joursRetard > 0 ? "Rappel de lead en retard" : "Rappel de lead prévu aujourd'hui");
      pushLeadAction("rappel", `Rappeler ${clientLabel}`, reasons, total);
      continue;
    }

    if ((lead.statut.key === "NOUVEAU" || lead.statut.key === "A_CONTACTER") && lead._count.interactions === 0) {
      const joursAnciennete = Math.floor((now.getTime() - lead.createdAt.getTime()) / 86_400_000);
      if (joursAnciennete >= 2) {
        const { total, reasons } = score({ joursRetard: joursAnciennete, montantBloqueCts: 0, bloque: false, documentManquant: false, typeAction: "LEAD", delaiAlerteDepasse: false });
        reasons.push("Lead jamais contacté - qualification incomplète");
        pushLeadAction("qualification", `Qualifier ${clientLabel}`, reasons, total);
      }
    }

    if (lead.statut.key === "ETUDE_A_FAIRE") {
      const { total, reasons } = score({ joursRetard: 0, montantBloqueCts: 0, bloque: false, documentManquant: false, typeAction: "LEAD", delaiAlerteDepasse: false });
      reasons.push("Étude P8 prête à être lancée pour ce lead");
      pushLeadAction("etude", `Lancer l'étude pour ${clientLabel}`, reasons, total);
    }

    if (lead.statut.key === "DEVIS_ENVOYE") {
      const { total, reasons } = score({ joursRetard: 0, montantBloqueCts: 0, bloque: false, documentManquant: false, typeAction: "LEAD", delaiAlerteDepasse: false });
      reasons.push("Devis envoyé - relance à prévoir");
      pushLeadAction("devis", `Relancer le devis de ${clientLabel}`, reasons, total);
    }
  }

  actions.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    const aEch = a.dateEcheance?.getTime() ?? Infinity;
    const bEch = b.dateEcheance?.getTime() ?? Infinity;
    return aEch - bEch;
  });

  return actions;
}

// Buckets temporels pour la vue "Mes actions" - regroupés ici (plutôt que
// dans la page) pour que l'appel impur à Date.now() reste dans une fonction
// utilitaire, jamais directement dans le corps d'un composant.
export function estAujourdhui(action: NextBestAction): boolean {
  if (action.joursRetard > 0) return true;
  if (!action.dateEcheance) return false;
  const finJournee = new Date();
  finJournee.setHours(23, 59, 59, 999);
  return action.dateEcheance.getTime() <= finJournee.getTime();
}

export function estCetteSemaine(action: NextBestAction): boolean {
  if (estAujourdhui(action)) return true;
  if (!action.dateEcheance) return false;
  const dansSeptJours = Date.now() + 7 * 86_400_000;
  return action.dateEcheance.getTime() <= dansSeptJours;
}
