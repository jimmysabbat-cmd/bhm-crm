import { prisma } from "@/lib/prisma";
import { calculerDelaiEtape } from "@/lib/workflow";
import { calculateBlockedAmountForDossier, mouvementIsLate, mouvementJoursRetard } from "@/lib/finance";
import { typeDocumentLabels, categorieMouvementLabels } from "@/lib/dossier-labels";
import type { Role } from "@/generated/prisma/enums";

export const roleLabels: Record<string, string> = {
  ADMIN: "Direction",
  COMMERCIAL: "Commercial",
  COMPTA: "Comptabilité",
  ADMINISTRATIF: "Administratif",
  REGIE: "Régie",
  SOUS_TRAITANT: "Sous-traitant",
  COMPTABILITE: "Comptabilité",
  TECHNIQUE: "Technique",
};

export type NiveauUrgence = "BASSE" | "NORMALE" | "HAUTE" | "CRITIQUE";
export type TypeNextBestAction = "ETAPE" | "TACHE" | "MOUVEMENT_FINANCIER" | "DOCUMENT_MANQUANT";

export type NextBestAction = {
  id: string;
  /** id brut de l'enregistrement source (DossierEtape/Tache/MouvementFinancier) pour les actions rapides. */
  sourceId: string;
  organisationId: string;
  dossierId: string;
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
      client: { select: { prenom: true, nom: true } },
      documents: { select: { type: true } },
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
