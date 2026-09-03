import { prisma } from "@/lib/prisma";
import { mouvementIsLate, mouvementJoursRetard } from "@/lib/finance";
import { CATEGORIES_COUVERTES_PAR_AGREGATS } from "@/lib/finance";
import { categorieMouvementLabels, resteAChargeCents } from "@/lib/dossier-labels";
import type {
  CategorieMouvementFinancier,
  StatutMouvementFinancier,
  PartiePrenante,
  TypeMouvementFinancier,
} from "@/generated/prisma/enums";

// ============================================================
// Moteur financier central (P6).
//
// Principe directeur (section 2 du prompt) : MouvementFinancier devient
// progressivement la source de vérité détaillée, mais les agrégats legacy
// du Dossier (montantEncaisseClient/MPR/CEE, montantAideMPR/CEE) restent
// utilisés en fallback/complément - jamais supprimés, jamais double-comptés.
// Chaque fonction documente sa hiérarchie de sources.
//
// Concepts distincts (section 1) - ne jamais les mélanger :
//   - CA CONTRACTUEL : Dossier.montantDevisTTC (calculateContractualRevenue)
//   - ENCAISSÉ / RESTE À ENCAISSER : cash réellement reçu (calculateEntrees)
//   - DÉPENSE PRÉVUE / RÉELLE : calculateForecastCosts / calculateActualCosts
//   - MARGE PRÉVISIONNELLE / RÉELLE : CA - coûts (jamais encaissé - payé)
//   - CRÉANCE / DETTE : mouvements ENTREE/SORTIE non soldés (dérivés, pas de
//     table dédiée - cf. commentaire au-dessus de getCreancesForDossier)
// ============================================================

// Catégories de SORTIE déjà comptées via DossierPosteTravaux (montant "prévu"
// legacy) - à exclure du calcul des coûts prévisionnels additionnels pour ne
// jamais compter deux fois le même coût.
const SORTIES_COUVERTES_PAR_POSTES = new Set<CategorieMouvementFinancier>([
  "PAIEMENT_SOUS_TRAITANT",
  "POSE_INTERNE",
]);

// Catégories d'ENTREE qui représentent une créance du client envers
// l'entreprise (solde dû, acompte, ou remboursement d'une avance faite par
// l'entreprise - cf. section 13). Sert de repli quand payeurType n'est pas
// renseigné sur le mouvement.
const CATEGORIES_CREANCE_CLIENT = new Set<CategorieMouvementFinancier>([
  "ENCAISSEMENT_CLIENT",
  "CLIENT_ACOMPTE",
  "CLIENT_SOLDE",
  "REMBOURSEMENT_AVANCE_CLIENT",
]);

const CATEGORIES_COMMISSION = new Set<CategorieMouvementFinancier>([
  "COMMISSION_COMMERCIALE",
  "COMMISSION_REGIE",
  "COMMISSION_APPORTEUR",
]);

// --- Helpers unitaires sur un mouvement (section 6) ------------------------

type MouvementMontants = {
  statut: StatutMouvementFinancier;
  montantPrevuCts: number | null;
  montantReelCts: number | null;
};

/** Ce qu'il reste à percevoir/payer sur ce mouvement (jamais négatif). */
export function getRemainingAmount(m: MouvementMontants): number {
  if (m.statut === "ANNULE") return 0;
  const prevu = m.montantPrevuCts ?? 0;
  const recu = m.montantReelCts ?? 0;
  return Math.max(prevu - recu, 0);
}

/** Un mouvement PARTIEL n'est jamais considéré comme soldé. */
export function isSettled(m: MouvementMontants): boolean {
  if (m.statut === "RECU" || m.statut === "PAYE" || m.statut === "ANNULE") return true;
  if (m.statut === "PARTIEL") return false;
  return getRemainingAmount(m) === 0 && (m.montantPrevuCts ?? 0) > 0;
}

// Réexportés sous les noms demandés par le prompt (section 6) - la logique
// de retard reste unique dans src/lib/finance.ts, jamais dupliquée.
export const isLate = mouvementIsLate;
export const joursRetard = mouvementJoursRetard;

// --- Audit avant/après (section 25) -----------------------------------------

type MouvementAvantApres = {
  montantPrevuCts: number | null;
  montantReelCts: number | null;
  datePrevue: Date | null;
  dateReelle: Date | null;
};

/**
 * Calcule le diff avant/après à consigner dans AuditLog.metadata pour une
 * modification de mouvement financier - fonction pure, réutilisée par
 * updateMouvementFinancier (Server Action) et testable indépendamment de
 * toute session (cf. scripts/test-financial-engine.ts, TEST 12).
 */
export function computeMouvementAuditDiff(before: MouvementAvantApres, apres: MouvementAvantApres): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = {};
  if (before.montantPrevuCts !== apres.montantPrevuCts) {
    metadata.montantPrevuAvantCts = before.montantPrevuCts ?? 0;
    metadata.montantPrevuApresCts = apres.montantPrevuCts ?? 0;
  }
  if (before.montantReelCts !== apres.montantReelCts) {
    metadata.montantReelAvantCts = before.montantReelCts ?? 0;
    metadata.montantReelApresCts = apres.montantReelCts ?? 0;
  }
  if (before.datePrevue?.getTime() !== apres.datePrevue?.getTime()) {
    metadata.datePrevueAvant = before.datePrevue?.toISOString() ?? null;
    metadata.datePrevueApres = apres.datePrevue?.toISOString() ?? null;
  }
  if (before.dateReelle?.getTime() !== apres.dateReelle?.getTime()) {
    metadata.dateReelleAvant = before.dateReelle?.toISOString() ?? null;
    metadata.dateReelleApres = apres.dateReelle?.toISOString() ?? null;
  }
  return metadata;
}

// --- CA contractuel (section 7) --------------------------------------------

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type ContractualRevenue = {
  amountCts: number;
  source: string;
  confidence: Confidence;
};

/**
 * CA contractuel du dossier - hiérarchie de sources explicite :
 *   1. Dossier.montantDevisTTC si > 0 (devis signé/saisi) -> HIGH
 *   2. sinon 0, confidence LOW ("inconnu")
 * Ne déduit JAMAIS le CA depuis les encaissements (section 7, dernière ligne).
 */
export async function calculateContractualRevenue(dossierId: string): Promise<ContractualRevenue> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { montantDevisTTC: true },
  });
  if (!dossier) {
    return { amountCts: 0, source: "dossier introuvable", confidence: "LOW" };
  }
  if (dossier.montantDevisTTC > 0) {
    return { amountCts: dossier.montantDevisTTC, source: "Dossier.montantDevisTTC (devis)", confidence: "HIGH" };
  }
  return { amountCts: 0, source: "aucun montant de devis renseigné", confidence: "LOW" };
}

// --- Facture (section 8) ---------------------------------------------------
// Aucune notion de facture réelle n'existe dans le modèle actuel (seul un
// DEVIS est tracé comme document). Fabriquer une facturation maintenant
// complexifierait inutilement le P6 pour un besoin non demandé ailleurs -
// on retourne explicitement "non géré actuellement" plutôt que d'inventer.
export function getInvoiceStatus(): { facture: "non géré actuellement" } {
  return { facture: "non géré actuellement" };
}

// --- Coûts (section 9/10) ---------------------------------------------------

export type CostDetail = { categorie: string; label: string; prevuCts: number; reelCts: number };
export type CostBreakdown = { totalCts: number; details: CostDetail[]; limites: string[] };

async function loadPostesCosts(dossierId: string): Promise<number> {
  const postes = await prisma.dossierPosteTravaux.findMany({
    where: { dossierId },
    select: { montantMaterielHTCts: true, montantMaterielTTCCts: true, montantPoseSousTraitanceCts: true, montantRegieCts: true },
  });
  return postes.reduce(
    (sum, p) =>
      sum + (p.montantMaterielTTCCts ?? p.montantMaterielHTCts ?? 0) + (p.montantPoseSousTraitanceCts ?? 0) + (p.montantRegieCts ?? 0),
    0
  );
}

/**
 * Coûts prévisionnels : coûts des postes de travaux (matériel + sous-
 * traitance + régie, source legacy déjà utilisée par le dashboard) + coûts
 * prévus des mouvements SORTIE dont la catégorie n'est PAS déjà représentée
 * dans les postes de travaux (commissions, MAR, audit, transport...).
 */
export async function calculateForecastCosts(dossierId: string): Promise<CostBreakdown> {
  const coutsPostesCts = await loadPostesCosts(dossierId);
  const details: CostDetail[] = [];
  if (coutsPostesCts > 0) {
    details.push({ categorie: "POSTES_TRAVAUX", label: "Postes de travaux (matériel + pose)", prevuCts: coutsPostesCts, reelCts: 0 });
  }

  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { dossierId, type: "SORTIE", statut: { not: "ANNULE" }, categorie: { notIn: Array.from(SORTIES_COUVERTES_PAR_POSTES) as never[] } },
  });
  let autresCts = 0;
  for (const m of mouvements) {
    autresCts += m.montantPrevuCts ?? m.montantReelCts ?? 0;
  }
  if (autresCts > 0) {
    details.push({ categorie: "AUTRES_SORTIES", label: "Autres sorties prévues (mouvements)", prevuCts: autresCts, reelCts: 0 });
  }

  return { totalCts: coutsPostesCts + autresCts, details, limites: [] };
}

/**
 * Coûts réels : UNIQUEMENT ce qui a été effectivement payé/partiellement payé
 * via MouvementFinancier (montantReelCts, ou montantPrevuCts en repli si le
 * mouvement est marqué PAYE sans montant réel saisi séparément). Les postes
 * de travaux n'ont pas de colonne "coût réel" - si aucun mouvement SORTIE
 * n'est enregistré, le coût réel connu est 0 et ce n'est PAS assimilé à
 * "aucun coût" (cf. limites).
 */
export async function calculateActualCosts(dossierId: string): Promise<CostBreakdown> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { dossierId, type: "SORTIE", statut: { in: ["PAYE", "PARTIEL"] } },
  });

  const parCategorie = new Map<CategorieMouvementFinancier, number>();
  let totalCts = 0;
  for (const m of mouvements) {
    const montant = m.montantReelCts ?? m.montantPrevuCts ?? 0;
    totalCts += montant;
    parCategorie.set(m.categorie, (parCategorie.get(m.categorie) ?? 0) + montant);
  }

  const details: CostDetail[] = Array.from(parCategorie.entries()).map(([categorie, reelCts]) => ({
    categorie,
    label: categorieMouvementLabels[categorie],
    prevuCts: 0,
    reelCts,
  }));

  const limites: string[] = [];
  if (mouvements.length === 0) {
    limites.push(
      "Aucun mouvement financier de sortie soldé n'est enregistré pour ce dossier : le coût réel affiché (0 €) ne signifie pas qu'aucun coût n'a été engagé, seulement qu'aucun n'a été tracé."
    );
  }

  return { totalCts, details, limites };
}

// --- Marges (section 9/10) --------------------------------------------------

export type MarginResult = {
  revenuCts: number;
  revenuSource: string;
  coutsCts: number;
  margeCts: number;
  margePct: number | null;
  details: CostDetail[];
  limites: string[];
};

/**
 * Marge prévisionnelle = CA contractuel - coûts prévisionnels.
 * IMPORTANT (section 9) : les aides ANAH/MPR/CEE ne sont PAS ajoutées au CA -
 * elles sont un mode de financement de ce même CA (montantDevisTTC les
 * inclut déjà), jamais une source de revenu supplémentaire. C'est pourquoi
 * cette fonction ne lit que Dossier.montantDevisTTC, jamais les aides.
 */
export async function calculateForecastMargin(dossierId: string): Promise<MarginResult> {
  const revenu = await calculateContractualRevenue(dossierId);
  const couts = await calculateForecastCosts(dossierId);
  const margeCts = revenu.amountCts - couts.totalCts;
  const margePct = revenu.amountCts > 0 ? (margeCts / revenu.amountCts) * 100 : null;

  const limites = [...couts.limites];
  if (revenu.confidence === "LOW") limites.push("CA contractuel inconnu (aucun devis renseigné) : marge non fiable.");

  return { revenuCts: revenu.amountCts, revenuSource: revenu.source, coutsCts: couts.totalCts, margeCts, margePct, details: couts.details, limites };
}

/**
 * Marge réelle = CA contractuel (revenu reconnu - pas de facturation
 * distincte dans cette V1, cf. section 8) - coûts réellement engagés/payés.
 */
export async function calculateActualMargin(dossierId: string): Promise<MarginResult> {
  const revenu = await calculateContractualRevenue(dossierId);
  const couts = await calculateActualCosts(dossierId);
  const margeCts = revenu.amountCts - couts.totalCts;
  const margePct = revenu.amountCts > 0 ? (margeCts / revenu.amountCts) * 100 : null;

  const limites = [...couts.limites];
  if (revenu.confidence === "LOW") limites.push("CA contractuel inconnu (aucun devis renseigné) : marge non fiable.");

  return { revenuCts: revenu.amountCts, revenuSource: revenu.source, coutsCts: couts.totalCts, margeCts, margePct, details: couts.details, limites };
}

// --- Entrées / sorties globales du dossier (section 11) --------------------

export type FlowDetail = { categorie: string; label: string; type: TypeMouvementFinancier; prevuCts: number; reelCts: number; resteCts: number };

async function loadDossierAggregats(dossierId: string) {
  return prisma.dossier.findUniqueOrThrow({
    where: { id: dossierId },
    select: { montantAideMPR: true, montantAideCEE: true, montantEncaisseClient: true, montantEncaisseMPR: true, montantEncaisseCEE: true, montantDevisTTC: true },
  });
}

/**
 * Total encaissé et reste à encaisser (toutes entrées confondues : client,
 * ANAH/MPR, CEE, financement partenaire, remboursement d'avance...).
 * Source : agrégats legacy pour les 3 catégories historiques + mouvements
 * ENTREE pour tout le reste, jamais les deux pour la même catégorie.
 */
export async function calculateEntrees(dossierId: string): Promise<{ encaisseCts: number; resteAEncaisserCts: number; details: FlowDetail[] }> {
  const d = await loadDossierAggregats(dossierId);

  const details: FlowDetail[] = [];
  let encaisseCts = 0;
  let resteCts = 0;

  const resteClient = Math.max(resteAChargeCents(d) - d.montantEncaisseClient, 0);
  details.push({ categorie: "ENCAISSEMENT_CLIENT", label: "Client (legacy)", type: "ENTREE", prevuCts: resteAChargeCents(d), reelCts: d.montantEncaisseClient, resteCts: resteClient });
  encaisseCts += d.montantEncaisseClient;
  resteCts += resteClient;

  const resteMPR = Math.max(d.montantAideMPR - d.montantEncaisseMPR, 0);
  details.push({ categorie: "ENCAISSEMENT_MPR", label: "ANAH / MPR (legacy)", type: "ENTREE", prevuCts: d.montantAideMPR, reelCts: d.montantEncaisseMPR, resteCts: resteMPR });
  encaisseCts += d.montantEncaisseMPR;
  resteCts += resteMPR;

  const resteCEE = Math.max(d.montantAideCEE - d.montantEncaisseCEE, 0);
  details.push({ categorie: "ENCAISSEMENT_CEE", label: "CEE (legacy)", type: "ENTREE", prevuCts: d.montantAideCEE, reelCts: d.montantEncaisseCEE, resteCts: resteCEE });
  encaisseCts += d.montantEncaisseCEE;
  resteCts += resteCEE;

  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { dossierId, type: "ENTREE", statut: { not: "ANNULE" }, categorie: { notIn: Array.from(CATEGORIES_COUVERTES_PAR_AGREGATS) as never[] } },
  });
  const parCategorie = new Map<CategorieMouvementFinancier, { prevuCts: number; reelCts: number; resteCts: number }>();
  for (const m of mouvements) {
    const prevuCts = m.montantPrevuCts ?? 0;
    const reelCts = m.montantReelCts ?? 0;
    const resteM = getRemainingAmount(m);
    const cur = parCategorie.get(m.categorie) ?? { prevuCts: 0, reelCts: 0, resteCts: 0 };
    parCategorie.set(m.categorie, { prevuCts: cur.prevuCts + prevuCts, reelCts: cur.reelCts + reelCts, resteCts: cur.resteCts + resteM });
    encaisseCts += reelCts;
    resteCts += resteM;
  }
  for (const [categorie, v] of parCategorie) {
    details.push({ categorie, label: categorieMouvementLabels[categorie], type: "ENTREE", ...v });
  }

  return { encaisseCts, resteAEncaisserCts: resteCts, details };
}

/**
 * Total payé et reste à payer (toutes sorties : sous-traitants, fournisseurs,
 * commissions, MAR, audits, etc.), entièrement issu de MouvementFinancier -
 * il n'existe pas d'agrégat legacy pour les sorties.
 */
export async function calculateSorties(dossierId: string): Promise<{ payeCts: number; sortiesPrevuesCts: number; resteAPayerCts: number; details: FlowDetail[] }> {
  const mouvements = await prisma.mouvementFinancier.findMany({ where: { dossierId, type: "SORTIE", statut: { not: "ANNULE" } } });

  const parCategorie = new Map<CategorieMouvementFinancier, { prevuCts: number; reelCts: number; resteCts: number }>();
  let payeCts = 0;
  let sortiesPrevuesCts = 0;
  let resteCts = 0;
  for (const m of mouvements) {
    const prevuCts = m.montantPrevuCts ?? 0;
    const reelCts = m.montantReelCts ?? 0;
    const resteM = getRemainingAmount(m);
    payeCts += reelCts;
    sortiesPrevuesCts += prevuCts;
    resteCts += resteM;
    const cur = parCategorie.get(m.categorie) ?? { prevuCts: 0, reelCts: 0, resteCts: 0 };
    parCategorie.set(m.categorie, { prevuCts: cur.prevuCts + prevuCts, reelCts: cur.reelCts + reelCts, resteCts: cur.resteCts + resteM });
  }

  const details: FlowDetail[] = Array.from(parCategorie.entries()).map(([categorie, v]) => ({
    categorie,
    label: categorieMouvementLabels[categorie],
    type: "SORTIE",
    ...v,
  }));

  return { payeCts, sortiesPrevuesCts, resteAPayerCts: resteCts, details };
}

// --- Créances (section 14) --------------------------------------------------
//
// Pas de modèle Prisma dédié : une créance est un mouvement ENTREE non soldé
// dont le payeur est le client (payeurType = CLIENT, ou à défaut une
// catégorie explicitement client si payeurType n'a pas été renseigné). Créer
// un second modèle dupliquerait la même vérité (montant, dates, statut) déjà
// portée par MouvementFinancier et risquerait la désynchronisation - exactement
// ce que la section 2 du prompt demande d'éviter. Le scénario "avance ANAH
// versée au client" (section 13) est une créance comme une autre, taguée via
// la catégorie REMBOURSEMENT_AVANCE_CLIENT : rien de spécifique à l'ANAH n'est
// codé en dur.

export type StatutCreanceOuDette = "OUVERTE" | "PARTIELLE" | "REGLEE" | "EN_RETARD" | "LITIGE" | "ANNULEE";

function statutDerive(m: { statut: StatutMouvementFinancier; datePrevue: Date | null; montantPrevuCts: number | null; montantReelCts: number | null }): StatutCreanceOuDette {
  if (m.statut === "ANNULE") return "ANNULEE";
  if (m.statut === "LITIGE") return "LITIGE";
  if (isSettled(m)) return "REGLEE";
  if (mouvementIsLate(m)) return "EN_RETARD";
  if (m.statut === "PARTIEL" || (m.montantReelCts ?? 0) > 0) return "PARTIELLE";
  return "OUVERTE";
}

export type CreanceDerivee = {
  mouvementId: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  debiteurType: PartiePrenante | null;
  debiteurNom: string | null;
  montantInitialCts: number;
  montantRecouvreCts: number;
  resteCts: number;
  dateCreation: Date;
  dateEcheance: Date | null;
  statut: StatutCreanceOuDette;
  origine: string | null;
  commentaire: string | null;
  joursRetard: number;
};

function toCreance(m: {
  id: string;
  dossierId: string;
  dossier: { reference: string; client: { prenom: string; nom: string } };
  payeurType: PartiePrenante | null;
  payeur: string | null;
  montantPrevuCts: number | null;
  montantReelCts: number | null;
  createdAt: Date;
  datePrevue: Date | null;
  statut: StatutMouvementFinancier;
  origine: string | null;
  commentaire: string | null;
}): CreanceDerivee {
  return {
    mouvementId: m.id,
    dossierId: m.dossierId,
    dossierReference: m.dossier.reference,
    clientLabel: `${m.dossier.client.prenom} ${m.dossier.client.nom}`,
    debiteurType: m.payeurType,
    debiteurNom: m.payeur,
    montantInitialCts: m.montantPrevuCts ?? 0,
    montantRecouvreCts: m.montantReelCts ?? 0,
    resteCts: getRemainingAmount(m),
    dateCreation: m.createdAt,
    dateEcheance: m.datePrevue,
    statut: statutDerive(m),
    origine: m.origine,
    commentaire: m.commentaire,
    joursRetard: mouvementJoursRetard(m),
  };
}

const CREANCE_INCLUDE = { dossier: { select: { reference: true, client: { select: { prenom: true, nom: true } } } } } as const;

export async function getCreancesForDossier(dossierId: string): Promise<CreanceDerivee[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: {
      dossierId,
      type: "ENTREE",
      statut: { not: "ANNULE" },
      OR: [{ payeurType: "CLIENT" }, { payeurType: null, categorie: { in: Array.from(CATEGORIES_CREANCE_CLIENT) as never[] } }],
    },
    include: CREANCE_INCLUDE,
    orderBy: { datePrevue: "asc" },
  });
  return mouvements.filter((m) => !isSettled(m)).map(toCreance);
}

export async function getCreancesForOrganisation(organisationId: string): Promise<CreanceDerivee[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: {
      organisationId,
      type: "ENTREE",
      statut: { not: "ANNULE" },
      OR: [{ payeurType: "CLIENT" }, { payeurType: null, categorie: { in: Array.from(CATEGORIES_CREANCE_CLIENT) as never[] } }],
    },
    include: CREANCE_INCLUDE,
    orderBy: { datePrevue: "asc" },
  });
  return mouvements.filter((m) => !isSettled(m)).map(toCreance);
}

// --- Dettes (section 15) ----------------------------------------------------
// Même principe : une dette est un mouvement SORTIE en A_PAYER/PARTIEL, sans
// duplication de modèle (section 15 : "Ne duplique pas inutilement").

export type DetteDerivee = Omit<CreanceDerivee, "debiteurType" | "debiteurNom"> & {
  beneficiaireType: PartiePrenante | null;
  beneficiaireNom: string | null;
};

function toDette(m: {
  id: string;
  dossierId: string;
  dossier: { reference: string; client: { prenom: string; nom: string } };
  beneficiaireType: PartiePrenante | null;
  beneficiaire: string | null;
  montantPrevuCts: number | null;
  montantReelCts: number | null;
  createdAt: Date;
  datePrevue: Date | null;
  statut: StatutMouvementFinancier;
  origine: string | null;
  commentaire: string | null;
}): DetteDerivee {
  return {
    mouvementId: m.id,
    dossierId: m.dossierId,
    dossierReference: m.dossier.reference,
    clientLabel: `${m.dossier.client.prenom} ${m.dossier.client.nom}`,
    beneficiaireType: m.beneficiaireType,
    beneficiaireNom: m.beneficiaire,
    montantInitialCts: m.montantPrevuCts ?? 0,
    montantRecouvreCts: m.montantReelCts ?? 0,
    resteCts: getRemainingAmount(m),
    dateCreation: m.createdAt,
    dateEcheance: m.datePrevue,
    statut: statutDerive(m),
    origine: m.origine,
    commentaire: m.commentaire,
    joursRetard: mouvementJoursRetard(m),
  };
}

const DETTE_INCLUDE = { dossier: { select: { reference: true, client: { select: { prenom: true, nom: true } } } } } as const;

export async function getDettesForDossier(dossierId: string): Promise<DetteDerivee[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { dossierId, type: "SORTIE", statut: { in: ["A_PAYER", "PARTIEL"] } },
    include: DETTE_INCLUDE,
    orderBy: { datePrevue: "asc" },
  });
  return mouvements.map(toDette);
}

export async function getDettesForOrganisation(organisationId: string): Promise<DetteDerivee[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId, type: "SORTIE", statut: { in: ["A_PAYER", "PARTIEL"] } },
    include: DETTE_INCLUDE,
    orderBy: { datePrevue: "asc" },
  });
  return mouvements.map(toDette);
}

// --- Commissions (section 16) -----------------------------------------------
// Une commission est une dette d'une catégorie particulière (COMMISSION_*) -
// même raisonnement que pour les créances/dettes : pas de modèle dédié.
// exigibleQuand (section 17) est porté directement par le mouvement.

export type CommissionExigible = DetteDerivee & { exigibleQuand: string | null };

export async function getCommissionsExigibles(organisationId: string): Promise<CommissionExigible[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId, type: "SORTIE", categorie: { in: Array.from(CATEGORIES_COMMISSION) as never[] }, statut: { not: "ANNULE" } },
    include: DETTE_INCLUDE,
    orderBy: { datePrevue: "asc" },
  });
  return mouvements.filter((m) => !isSettled(m)).map((m) => ({ ...toDette(m), exigibleQuand: m.exigibleQuand }));
}

// --- Synthèse dossier (section 11) ------------------------------------------

export type FinancialSummary = {
  caContractuelCts: number;
  caSource: string;
  caConfidence: Confidence;
  encaisseCts: number;
  resteAEncaisserCts: number;
  entreesAttenduesCts: number;
  sortiesPrevuesCts: number;
  sortiesPayeesCts: number;
  resteAPayerCts: number;
  margePrevisionnelleCts: number;
  margePrevisionnellePct: number | null;
  margeReelleCts: number;
  margeReellePct: number | null;
  creancesCts: number;
  dettesCts: number;
  detailsEntrees: FlowDetail[];
  detailsSorties: FlowDetail[];
  limites: string[];
};

export async function getFinancialSummaryForDossier(dossierId: string): Promise<FinancialSummary> {
  const [ca, entrees, sorties, margePrev, margeReelle, creances, dettes] = await Promise.all([
    calculateContractualRevenue(dossierId),
    calculateEntrees(dossierId),
    calculateSorties(dossierId),
    calculateForecastMargin(dossierId),
    calculateActualMargin(dossierId),
    getCreancesForDossier(dossierId),
    getDettesForDossier(dossierId),
  ]);

  const limites = Array.from(new Set([...margePrev.limites, ...margeReelle.limites]));

  return {
    caContractuelCts: ca.amountCts,
    caSource: ca.source,
    caConfidence: ca.confidence,
    encaisseCts: entrees.encaisseCts,
    resteAEncaisserCts: entrees.resteAEncaisserCts,
    entreesAttenduesCts: entrees.resteAEncaisserCts,
    sortiesPrevuesCts: sorties.sortiesPrevuesCts,
    sortiesPayeesCts: sorties.payeCts,
    resteAPayerCts: sorties.resteAPayerCts,
    margePrevisionnelleCts: margePrev.margeCts,
    margePrevisionnellePct: margePrev.margePct,
    margeReelleCts: margeReelle.margeCts,
    margeReellePct: margeReelle.margePct,
    creancesCts: creances.reduce((s, c) => s + c.resteCts, 0),
    dettesCts: dettes.reduce((s, d) => s + d.resteCts, 0),
    detailsEntrees: entrees.details,
    detailsSorties: sorties.details,
    limites,
  };
}

// --- Vue organisation pour /finances (sections 21/22) -----------------------

export type MouvementAvecDossier = {
  id: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  type: TypeMouvementFinancier;
  categorie: CategorieMouvementFinancier;
  categorieLabel: string;
  statut: StatutMouvementFinancier;
  payeur: string | null;
  beneficiaire: string | null;
  montantPrevuCts: number | null;
  montantReelCts: number | null;
  resteCts: number;
  datePrevue: Date | null;
  dateReelle: Date | null;
  joursRetard: number;
  enRetard: boolean;
};

/** Tous les mouvements ENTREE ou SORTIE non soldés de l'organisation, pour les sections "À encaisser"/"À payer"/"En retard" de /finances. */
export async function getMouvementsNonSoldes(organisationId: string, type: TypeMouvementFinancier): Promise<MouvementAvecDossier[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId, type, statut: { not: "ANNULE" } },
    include: { dossier: { select: { reference: true, client: { select: { prenom: true, nom: true } } } } },
    orderBy: { datePrevue: "asc" },
  });
  return mouvements
    .filter((m) => !isSettled(m))
    .map((m) => ({
      id: m.id,
      dossierId: m.dossierId,
      dossierReference: m.dossier.reference,
      clientLabel: `${m.dossier.client.prenom} ${m.dossier.client.nom}`,
      type: m.type,
      categorie: m.categorie,
      categorieLabel: categorieMouvementLabels[m.categorie],
      statut: m.statut,
      payeur: m.payeur,
      beneficiaire: m.beneficiaire,
      montantPrevuCts: m.montantPrevuCts,
      montantReelCts: m.montantReelCts,
      resteCts: getRemainingAmount(m),
      datePrevue: m.datePrevue,
      dateReelle: m.dateReelle,
      joursRetard: mouvementJoursRetard(m),
      enRetard: mouvementIsLate(m),
    }));
}

export type MargeDossier = {
  dossierId: string;
  reference: string;
  clientLabel: string;
  caContractuelCts: number;
  encaisseCts: number;
  resteAEncaisserCts: number;
  coutPrevuCts: number;
  coutReelCts: number;
  margePrevisionnelleCts: number;
  margeReelleCts: number;
  creancesCts: number;
  dettesCts: number;
};

/** Tableau des dossiers actifs avec leur synthèse financière (section 22 - uniquement pour /finances, pas /dossiers). */
export async function getMargesDossiers(organisationId: string): Promise<MargeDossier[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId, statut: { key: { not: "CLOTURE" } } },
    select: { id: true, reference: true, client: { select: { prenom: true, nom: true } } },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    dossiers.map(async (d) => {
      const [resume, creances, dettes] = await Promise.all([
        getFinancialSummaryForDossier(d.id),
        getCreancesForDossier(d.id),
        getDettesForDossier(d.id),
      ]);
      return {
        dossierId: d.id,
        reference: d.reference,
        clientLabel: `${d.client.prenom} ${d.client.nom}`,
        caContractuelCts: resume.caContractuelCts,
        encaisseCts: resume.encaisseCts,
        resteAEncaisserCts: resume.resteAEncaisserCts,
        coutPrevuCts: resume.sortiesPrevuesCts,
        coutReelCts: resume.sortiesPayeesCts,
        margePrevisionnelleCts: resume.margePrevisionnelleCts,
        margeReelleCts: resume.margeReelleCts,
        creancesCts: creances.reduce((s, c) => s + c.resteCts, 0),
        dettesCts: dettes.reduce((s, dt) => s + dt.resteCts, 0),
      };
    })
  );
}

// --- Trésorerie prévisionnelle (section 18) ---------------------------------

export type CashflowBucket = {
  periodeLabel: string;
  periodeDebut: Date;
  periodeFin: Date;
  entreesCts: number;
  sortiesCts: number;
  netCts: number;
  cumulNetCts: number;
};

export type CashflowForecast = {
  buckets: CashflowBucket[];
  sansDate: { entreesCts: number; sortiesCts: number; nombreMouvements: number };
};

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function bucketKey(date: Date, granularite: "semaine" | "mois"): { key: string; label: string; debut: Date; fin: Date } {
  if (granularite === "mois") {
    const debut = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
    const fin = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0));
    const label = debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return { key: `${date.getFullYear()}-${date.getMonth()}`, label, debut, fin };
  }
  const debut = startOfIsoWeek(date);
  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + 6);
  const semaine = isoWeekNumber(date);
  return { key: `${debut.getUTCFullYear()}-W${semaine}`, label: `Semaine ${semaine} (${debut.getUTCFullYear()})`, debut, fin };
}

/**
 * Prévision de flux de trésorerie (PAS un solde bancaire - aucun solde
 * d'ouverture connu, cf. section 18). Agrège, par semaine ou par mois, le
 * reste à percevoir/payer des mouvements dont la date prévue tombe dans la
 * période demandée. Les mouvements sans datePrevue ne sont jamais rattachés
 * à une fausse date (section 19) : ils sont isolés dans `sansDate`.
 */
export async function getCashflowForecast(
  organisationId: string,
  dateDebut: Date,
  dateFin: Date,
  granularite: "semaine" | "mois" = "semaine"
): Promise<CashflowForecast> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId, statut: { not: "ANNULE" } },
  });

  const buckets = new Map<string, CashflowBucket>();
  const sansDate = { entreesCts: 0, sortiesCts: 0, nombreMouvements: 0 };

  for (const m of mouvements) {
    const reste = getRemainingAmount(m);
    if (reste <= 0) continue;

    if (!m.datePrevue) {
      if (m.type === "ENTREE") sansDate.entreesCts += reste;
      else sansDate.sortiesCts += reste;
      sansDate.nombreMouvements += 1;
      continue;
    }
    if (m.datePrevue < dateDebut || m.datePrevue > dateFin) continue;

    const { key, label, debut, fin } = bucketKey(m.datePrevue, granularite);
    const bucket = buckets.get(key) ?? { periodeLabel: label, periodeDebut: debut, periodeFin: fin, entreesCts: 0, sortiesCts: 0, netCts: 0, cumulNetCts: 0 };
    if (m.type === "ENTREE") bucket.entreesCts += reste;
    else bucket.sortiesCts += reste;
    bucket.netCts = bucket.entreesCts - bucket.sortiesCts;
    buckets.set(key, bucket);
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.periodeDebut.getTime() - b.periodeDebut.getTime());
  let cumul = 0;
  for (const b of sorted) {
    cumul += b.netCts;
    b.cumulNetCts = cumul;
  }

  return { buckets: sorted, sansDate };
}
