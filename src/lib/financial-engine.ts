import { prisma } from "@/lib/prisma";
import { mouvementIsLate, mouvementJoursRetard } from "@/lib/finance";
import { categorieMouvementLabels, statutMouvementLabels, resteAChargeCents } from "@/lib/dossier-labels";
import type {
  CategorieMouvementFinancier,
  StatutMouvementFinancier,
  PartiePrenante,
  TypeMouvementFinancier,
} from "@/generated/prisma/enums";

// ============================================================
// Moteur financier central (P6, corrigé par P6B).
//
// Principe directeur (section 2 du prompt P6) : MouvementFinancier devient
// progressivement la source de vérité détaillée, mais les agrégats legacy
// du Dossier (montantEncaisseClient/MPR/CEE, montantAideMPR/CEE) restent
// utilisés en fallback/complément - JAMAIS les deux à la fois pour la même
// catégorie (cf. getEntreeLignesForDossier : bascule "détaillé si présent,
// sinon legacy" par flux, jamais une addition des deux). Chaque fonction
// documente sa hiérarchie de sources.
//
// Concepts distincts (section 1 du prompt P6, précisés par P6B) - ne jamais
// les mélanger :
//   - CA CONTRACTUEL : Dossier.montantDevisTTC (calculateContractualRevenue)
//   - ENCAISSÉ / RESTE À ENCAISSER : cash réellement reçu (calculateEntrees).
//     ATTENTION (P6B section 2) : un encaissement est un FLUX DE TRÉSORERIE,
//     jamais un revenu reconnu au sens comptable - ne jamais le présenter
//     comme tel.
//   - DÉPENSE PRÉVUE / RÉELLE : calculateForecastCosts / calculateActualCosts
//   - MARGE PRÉVISIONNELLE (CA - coûts prévus) / MARGE SUR COÛTS RÉELS
//     CONNUS (CA - coûts réels, calculateMargeSurCoutsReelsConnus) / MARGE
//     RÉALISÉE (revenu reconnu - coûts, calculateMargeRealisee - toujours
//     NON_CALCULABLE en V1, cf. P6B section 1 : ne jamais confondre "CA
//     contractuel - coûts réels" avec une marge réellement réalisée).
//   - CRÉANCE / DETTE : mouvements ENTREE/SORTIE non soldés + repli legacy
//     par flux (dérivés, pas de table dédiée - cf. commentaire au-dessus de
//     getCreancesForDossier)
//   - financialDataQuality : indique si la synthèse d'un dossier s'appuie
//     sur des mouvements détaillés, un repli legacy, ou un mélange des deux
//     (cf. computeFinancialDataQuality) - pour savoir quels dossiers
//     enrichir en priorité.
// ============================================================

// Catégories de SORTIE déjà comptées via DossierPosteTravaux (montant "prévu"
// legacy) - à exclure du calcul des coûts prévisionnels additionnels pour ne
// jamais compter deux fois le même coût.
const SORTIES_COUVERTES_PAR_POSTES = new Set<CategorieMouvementFinancier>([
  "PAIEMENT_SOUS_TRAITANT",
  "POSE_INTERNE",
]);

// Les 3 "flux" historiquement portés par des agrégats sur Dossier (section 3
// du prompt P6B). Un mouvement dont la catégorie appartient à l'un de ces
// groupes REMPLACE le repli legacy correspondant pour ce dossier (jamais
// additionné) - cf. getEntreeLignesForDossier.
const FLUX_CLIENT_BALANCE_CATEGORIES = new Set<CategorieMouvementFinancier>([
  "ENCAISSEMENT_CLIENT",
  "CLIENT_ACOMPTE",
  "CLIENT_SOLDE",
]);
const FLUX_MPR_CATEGORIES = new Set<CategorieMouvementFinancier>(["ENCAISSEMENT_ANAH", "ENCAISSEMENT_MPR"]);
const FLUX_CEE_CATEGORIES = new Set<CategorieMouvementFinancier>(["ENCAISSEMENT_CEE"]);

type FluxEntree = "CLIENT" | "MPR" | "CEE" | "AUTRE";

function fluxDe(categorie: CategorieMouvementFinancier): FluxEntree {
  if (FLUX_CLIENT_BALANCE_CATEGORIES.has(categorie)) return "CLIENT";
  if (FLUX_MPR_CATEGORIES.has(categorie)) return "MPR";
  if (FLUX_CEE_CATEGORIES.has(categorie)) return "CEE";
  return "AUTRE";
}

// REMBOURSEMENT_AVANCE_CLIENT (section 13 du prompt P6) est une créance du
// client comme une autre, mais n'appartient volontairement PAS au flux
// "CLIENT" ci-dessus : une avance ne doit jamais faire disparaître le solde
// client normal du repli legacy (les deux peuvent coexister sur un même
// dossier - cf. TEST 6 de scripts/test-financial-engine.ts).
function estLigneCreanceClient(l: { flux: FluxEntree; categorieRaw: string }): boolean {
  return l.flux === "CLIENT" || l.categorieRaw === "REMBOURSEMENT_AVANCE_CLIENT";
}

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
 * Marge sur coûts réels connus = CA contractuel - coûts réellement engagés/
 * payés (cf. calculateActualCosts). ATTENTION (P6B, section 1) : ce calcul
 * n'est PAS une marge "réalisée" au sens comptable - il compare un CA
 * contractuel (un montant de devis) à des coûts réels, sans qu'aucun revenu
 * ne soit réellement "reconnu" (facturé, comptabilisé). Le nom reflète
 * volontairement cette limite ; ne jamais le renommer "marge réelle" dans
 * l'UI. Pour la vraie notion de marge réalisée, cf. calculateMargeRealisee.
 */
export async function calculateMargeSurCoutsReelsConnus(dossierId: string): Promise<MarginResult> {
  const revenu = await calculateContractualRevenue(dossierId);
  const couts = await calculateActualCosts(dossierId);
  const margeCts = revenu.amountCts - couts.totalCts;
  const margePct = revenu.amountCts > 0 ? (margeCts / revenu.amountCts) * 100 : null;

  const limites = [...couts.limites];
  if (revenu.confidence === "LOW") limites.push("CA contractuel inconnu (aucun devis renseigné) : marge non fiable.");

  return { revenuCts: revenu.amountCts, revenuSource: revenu.source, coutsCts: couts.totalCts, margeCts, margePct, details: couts.details, limites };
}

export type MargeRealisee =
  | { statut: "NON_CALCULABLE"; raison: string }
  | { statut: "CALCULEE"; revenuReconnuCts: number; coutsCts: number; margeCts: number; margePct: number | null; source: string };

/**
 * Marge réalisée au sens comptable = revenu effectivement reconnu (facturé/
 * comptabilisé) - coûts réels. Le CRM n'a aujourd'hui AUCUNE notion de
 * facturation ni de reconnaissance de revenu (section 8 du prompt P6,
 * délibérément hors scope, cf. section 6 du prompt P6B) : un encaissement
 * (flux de trésorerie) n'est PAS un revenu reconnu (section 2 du prompt
 * P6B). Cette fonction retourne donc systématiquement NON_CALCULABLE pour
 * l'instant plutôt que d'inventer un chiffre trompeur - l'architecture est
 * prête (type discriminé) pour le jour où une vraie source de revenu
 * reconnu existera.
 */
export async function calculateMargeRealisee(_dossierId: string): Promise<MargeRealisee> {
  return {
    statut: "NON_CALCULABLE",
    raison:
      "Aucune notion de facturation ou de revenu reconnu n'existe encore dans le CRM : un encaissement est un flux de trésorerie, pas un revenu reconnu au sens comptable.",
  };
}

// --- Entrées / sorties globales du dossier (section 11 du prompt P6,
// couche centrale d'entrée réécrite par P6B section 3/4) ---------------------

export type FlowDetail = { categorie: string; label: string; type: TypeMouvementFinancier; prevuCts: number; reelCts: number; resteCts: number };

async function loadDossierAggregats(dossierId: string) {
  return prisma.dossier.findUniqueOrThrow({
    where: { id: dossierId },
    select: {
      reference: true,
      client: { select: { prenom: true, nom: true } },
      montantAideMPR: true,
      montantAideCEE: true,
      montantEncaisseClient: true,
      montantEncaisseMPR: true,
      montantEncaisseCEE: true,
      montantDevisTTC: true,
    },
  });
}

export type SourceLigne = "MOUVEMENT" | "LEGACY_AGGREGATE";
export type PrecisionLigne = "DETAILED" | "LEGACY";

/**
 * Une ligne d'entrée unifiée : soit un vrai MouvementFinancier (source
 * MOUVEMENT), soit une ligne VIRTUELLE reconstituée en lecture seule depuis
 * les agrégats legacy du Dossier quand aucun mouvement détaillé n'existe
 * pour ce flux (source LEGACY_AGGREGATE, precision LOW/LEGACY, datePrevue
 * toujours null - section 3 du prompt P6B). Rien n'est jamais écrit en base
 * pour ces lignes virtuelles : `id` commence par `legacy:` et ne correspond
 * à aucun enregistrement, elles ne supportent aucune action rapide.
 */
export type LigneEntreeUnifiee = {
  id: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  flux: FluxEntree;
  categorieLabel: string;
  categorieRaw: string;
  source: SourceLigne;
  precision: PrecisionLigne;
  payeur: string | null;
  payeurType: PartiePrenante | null;
  montantPrevuCts: number;
  montantReelCts: number;
  resteCts: number;
  datePrevue: Date | null;
  statutLabel: string;
  statutRaw: StatutMouvementFinancier | null;
  origine: string | null;
  commentaire: string | null;
  createdAt: Date | null;
  joursRetard: number;
  enRetard: boolean;
};

function ligneLegacy(params: {
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  flux: FluxEntree;
  label: string;
  prevuCts: number;
  reelCts: number;
  resteCts: number;
}): LigneEntreeUnifiee {
  return {
    id: `legacy:${params.dossierId}:${params.flux}`,
    dossierId: params.dossierId,
    dossierReference: params.dossierReference,
    clientLabel: params.clientLabel,
    flux: params.flux,
    categorieLabel: params.label,
    categorieRaw: `LEGACY_${params.flux}`,
    source: "LEGACY_AGGREGATE",
    precision: "LEGACY",
    payeur: null,
    payeurType: params.flux === "CLIENT" ? "CLIENT" : params.flux === "MPR" ? "ANAH" : "CEE",
    montantPrevuCts: params.prevuCts,
    montantReelCts: params.reelCts,
    resteCts: params.resteCts,
    datePrevue: null,
    statutLabel: params.resteCts > 0 ? "À recevoir (legacy)" : "Soldé (legacy)",
    statutRaw: null,
    origine: "LEGACY_AGGREGATE",
    commentaire: null,
    createdAt: null,
    joursRetard: 0,
    enRetard: false,
  };
}

/**
 * LA fonction centrale des entrées d'un dossier (section 4 du prompt P6B) -
 * réutilisée par la fiche dossier, /finances, le dashboard et le cashflow.
 * Pour chacun des 3 flux legacy (CLIENT/MPR/CEE) : si au moins un
 * MouvementFinancier détaillé existe pour ce flux, il REMPLACE entièrement
 * le repli legacy (jamais une addition des deux - section 4 : "ne pas
 * ajouter le montant legacy correspondant"). Sinon, une ligne virtuelle
 * LEGACY_AGGREGATE est produite en lecture seule. Les catégories hors flux
 * legacy (financement partenaire, remboursement d'avance, autre) sont
 * toujours ajoutées telles quelles depuis les mouvements, sans équivalent
 * legacy possible.
 */
export async function getEntreeLignesForDossier(dossierId: string): Promise<LigneEntreeUnifiee[]> {
  const d = await loadDossierAggregats(dossierId);
  const dossierReference = d.reference;
  const clientLabel = `${d.client.prenom} ${d.client.nom}`;

  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { dossierId, type: "ENTREE", statut: { not: "ANNULE" } },
  });

  const lignes: LigneEntreeUnifiee[] = [];
  const fluxDetailles = new Set<FluxEntree>();

  for (const m of mouvements) {
    const flux = fluxDe(m.categorie);
    if (flux !== "AUTRE") fluxDetailles.add(flux);
    lignes.push({
      id: m.id,
      dossierId,
      dossierReference,
      clientLabel,
      flux,
      categorieLabel: categorieMouvementLabels[m.categorie],
      categorieRaw: m.categorie,
      source: "MOUVEMENT",
      precision: "DETAILED",
      payeur: m.payeur,
      payeurType: m.payeurType,
      montantPrevuCts: m.montantPrevuCts ?? 0,
      montantReelCts: m.montantReelCts ?? 0,
      resteCts: getRemainingAmount(m),
      datePrevue: m.datePrevue,
      statutLabel: statutMouvementLabels[m.statut] ?? m.statut,
      statutRaw: m.statut,
      origine: m.origine,
      commentaire: m.commentaire,
      createdAt: m.createdAt,
      joursRetard: mouvementJoursRetard(m),
      enRetard: mouvementIsLate(m),
    });
  }

  if (!fluxDetailles.has("CLIENT")) {
    const prevuClient = resteAChargeCents(d);
    const resteClient = Math.max(prevuClient - d.montantEncaisseClient, 0);
    if (prevuClient > 0 || d.montantEncaisseClient > 0) {
      lignes.push(
        ligneLegacy({ dossierId, dossierReference, clientLabel, flux: "CLIENT", label: "Client (legacy)", prevuCts: prevuClient, reelCts: d.montantEncaisseClient, resteCts: resteClient })
      );
    }
  }
  if (!fluxDetailles.has("MPR")) {
    const resteMPR = Math.max(d.montantAideMPR - d.montantEncaisseMPR, 0);
    if (d.montantAideMPR > 0 || d.montantEncaisseMPR > 0) {
      lignes.push(
        ligneLegacy({ dossierId, dossierReference, clientLabel, flux: "MPR", label: "ANAH / MPR (legacy)", prevuCts: d.montantAideMPR, reelCts: d.montantEncaisseMPR, resteCts: resteMPR })
      );
    }
  }
  if (!fluxDetailles.has("CEE")) {
    const resteCEE = Math.max(d.montantAideCEE - d.montantEncaisseCEE, 0);
    if (d.montantAideCEE > 0 || d.montantEncaisseCEE > 0) {
      lignes.push(
        ligneLegacy({ dossierId, dossierReference, clientLabel, flux: "CEE", label: "CEE (legacy)", prevuCts: d.montantAideCEE, reelCts: d.montantEncaisseCEE, resteCts: resteCEE })
      );
    }
  }

  return lignes;
}

/** Version organisation de getEntreeLignesForDossier - une seule implémentation, jamais recopiée (section 4). */
export async function getEntreeLignesForOrganisation(organisationId: string): Promise<LigneEntreeUnifiee[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId, statut: { key: { not: "CLOTURE" } } },
    select: { id: true },
  });
  const parDossier = await Promise.all(dossiers.map((d) => getEntreeLignesForDossier(d.id)));
  return parDossier.flat();
}

export type FinancialDataQuality = "DETAILED" | "PARTIAL" | "LEGACY" | "INSUFFICIENT";

export const financialDataQualityLabels: Record<FinancialDataQuality, string> = {
  DETAILED: "Détaillé",
  PARTIAL: "Mixte (détaillé + legacy)",
  LEGACY: "Historique (legacy)",
  INSUFFICIENT: "Insuffisant",
};

/**
 * Qualité des données financières d'un dossier (section 5 du prompt P6B) :
 * DETAILED si tous les flux d'entrée en cours sont tracés par des
 * mouvements détaillés, LEGACY si tous reposent sur le repli agrégé,
 * PARTIAL si mélange des deux, INSUFFICIENT si le CA contractuel lui-même
 * est inconnu (rien de fiable ne peut être calculé).
 */
export function computeFinancialDataQuality(params: { caConfidence: Confidence; entreeLignes: { source: SourceLigne }[] }): FinancialDataQuality {
  if (params.caConfidence === "LOW") return "INSUFFICIENT";
  const total = params.entreeLignes.length;
  if (total === 0) return "DETAILED";
  const detaillees = params.entreeLignes.filter((l) => l.source === "MOUVEMENT").length;
  if (detaillees === total) return "DETAILED";
  if (detaillees === 0) return "LEGACY";
  return "PARTIAL";
}

/**
 * Total encaissé et reste à encaisser (toutes entrées confondues), agrégé
 * depuis getEntreeLignesForDossier - jamais de logique de repli recalculée
 * ici (section 4). ATTENTION (P6B section 2) : encaisseCts est un montant
 * de trésorerie réellement perçue, PAS un revenu reconnu au sens comptable
 * - ne jamais l'utiliser comme base d'une "marge réalisée".
 */
export async function calculateEntrees(dossierId: string): Promise<{ encaisseCts: number; resteAEncaisserCts: number; details: FlowDetail[]; lignes: LigneEntreeUnifiee[] }> {
  const lignes = await getEntreeLignesForDossier(dossierId);

  let encaisseCts = 0;
  let resteCts = 0;
  const parCategorie = new Map<string, FlowDetail>();
  for (const l of lignes) {
    encaisseCts += l.montantReelCts;
    resteCts += l.resteCts;
    const cur = parCategorie.get(l.categorieLabel) ?? { categorie: l.categorieLabel, label: l.categorieLabel, type: "ENTREE" as const, prevuCts: 0, reelCts: 0, resteCts: 0 };
    cur.prevuCts += l.montantPrevuCts;
    cur.reelCts += l.montantReelCts;
    cur.resteCts += l.resteCts;
    parCategorie.set(l.categorieLabel, cur);
  }

  return { encaisseCts, resteAEncaisserCts: resteCts, details: Array.from(parCategorie.values()), lignes };
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

// --- Créances (section 14 du prompt P6, couvre désormais le legacy -
// section 3 du prompt P6B) ---------------------------------------------------
//
// Pas de modèle Prisma dédié : une créance est une ligne d'entrée (mouvement
// détaillé OU repli legacy, cf. getEntreeLignesForDossier) dont le débiteur
// est le client - flux "CLIENT" (solde/acompte legacy ou détaillé) ou
// catégorie REMBOURSEMENT_AVANCE_CLIENT (section 13, avance générique quel
// qu'en soit le motif - jamais une logique spécifique ANAH codée en dur).
// Créer un second modèle dupliquerait la même vérité et risquerait la
// désynchronisation - exactement ce que la section 2 du prompt P6 demande
// d'éviter. Une créance née d'un repli legacy n'a ni date d'échéance ni
// historique de retard connus : son statut reste OUVERTE/REGLEE seulement,
// jamais EN_RETARD/LITIGE (on ne fabrique pas une précision qu'on n'a pas).

export type StatutCreanceOuDette = "OUVERTE" | "PARTIELLE" | "REGLEE" | "EN_RETARD" | "LITIGE" | "ANNULEE";

function statutDerive(m: { statut: StatutMouvementFinancier; datePrevue: Date | null; montantPrevuCts: number | null; montantReelCts: number | null }): StatutCreanceOuDette {
  if (m.statut === "ANNULE") return "ANNULEE";
  if (m.statut === "LITIGE") return "LITIGE";
  if (isSettled(m)) return "REGLEE";
  if (mouvementIsLate(m)) return "EN_RETARD";
  if (m.statut === "PARTIEL" || (m.montantReelCts ?? 0) > 0) return "PARTIELLE";
  return "OUVERTE";
}

function statutDeLigne(l: LigneEntreeUnifiee): StatutCreanceOuDette {
  if (l.source === "LEGACY_AGGREGATE") return l.resteCts > 0 ? "OUVERTE" : "REGLEE";
  return statutDerive({ statut: l.statutRaw as StatutMouvementFinancier, datePrevue: l.datePrevue, montantPrevuCts: l.montantPrevuCts, montantReelCts: l.montantReelCts });
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
  dateCreation: Date | null;
  dateEcheance: Date | null;
  statut: StatutCreanceOuDette;
  origine: string | null;
  commentaire: string | null;
  joursRetard: number;
  precision: PrecisionLigne;
};

function toCreance(l: LigneEntreeUnifiee): CreanceDerivee {
  return {
    mouvementId: l.id,
    dossierId: l.dossierId,
    dossierReference: l.dossierReference,
    clientLabel: l.clientLabel,
    debiteurType: l.payeurType,
    debiteurNom: l.payeur,
    montantInitialCts: l.montantPrevuCts,
    montantRecouvreCts: l.montantReelCts,
    resteCts: l.resteCts,
    dateCreation: l.createdAt,
    dateEcheance: l.datePrevue,
    statut: statutDeLigne(l),
    origine: l.origine,
    commentaire: l.commentaire,
    joursRetard: l.joursRetard,
    precision: l.precision,
  };
}

export async function getCreancesForDossier(dossierId: string): Promise<CreanceDerivee[]> {
  const lignes = await getEntreeLignesForDossier(dossierId);
  return lignes.filter((l) => estLigneCreanceClient(l) && l.resteCts > 0).map(toCreance);
}

export async function getCreancesForOrganisation(organisationId: string): Promise<CreanceDerivee[]> {
  const lignes = await getEntreeLignesForOrganisation(organisationId);
  return lignes.filter((l) => estLigneCreanceClient(l) && l.resteCts > 0).map(toCreance);
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
    // Pas de repli legacy pour les dettes (section 3 du prompt P6B ne
    // concerne que les 3 flux d'entrée legacy) - toujours DETAILED.
    precision: "DETAILED",
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
  margeSurCoutsReelsCts: number;
  margeSurCoutsReelsPct: number | null;
  margeRealisee: MargeRealisee;
  creancesCts: number;
  dettesCts: number;
  detailsEntrees: FlowDetail[];
  detailsSorties: FlowDetail[];
  financialDataQuality: FinancialDataQuality;
  limites: string[];
};

export async function getFinancialSummaryForDossier(dossierId: string): Promise<FinancialSummary> {
  const [ca, entrees, sorties, margePrev, margeCoutsReels, margeRealisee, creances, dettes] = await Promise.all([
    calculateContractualRevenue(dossierId),
    calculateEntrees(dossierId),
    calculateSorties(dossierId),
    calculateForecastMargin(dossierId),
    calculateMargeSurCoutsReelsConnus(dossierId),
    calculateMargeRealisee(dossierId),
    getCreancesForDossier(dossierId),
    getDettesForDossier(dossierId),
  ]);

  const limites = Array.from(new Set([...margePrev.limites, ...margeCoutsReels.limites]));
  const financialDataQuality = computeFinancialDataQuality({ caConfidence: ca.confidence, entreeLignes: entrees.lignes });

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
    margeSurCoutsReelsCts: margeCoutsReels.margeCts,
    margeSurCoutsReelsPct: margeCoutsReels.margePct,
    margeRealisee,
    creancesCts: creances.reduce((s, c) => s + c.resteCts, 0),
    dettesCts: dettes.reduce((s, d) => s + d.resteCts, 0),
    detailsEntrees: entrees.details,
    detailsSorties: sorties.details,
    financialDataQuality,
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
  margeSurCoutsReelsCts: number;
  creancesCts: number;
  dettesCts: number;
  financialDataQuality: FinancialDataQuality;
};

/** Tableau des dossiers actifs avec leur synthèse financière (section 22 du prompt P6 - uniquement pour /finances, pas /dossiers). Même couche centrale que le dashboard (section 4/5 du prompt P6B). */
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
        margeSurCoutsReelsCts: resume.margeSurCoutsReelsCts,
        creancesCts: creances.reduce((s, c) => s + c.resteCts, 0),
        dettesCts: dettes.reduce((s, dt) => s + dt.resteCts, 0),
        financialDataQuality: resume.financialDataQuality,
      };
    })
  );
}

// --- Argent bloqué (P5, relocalisé ici par la section 4 du prompt P6B pour
// réutiliser la même couche centrale d'entrées que la fiche dossier,
// /finances, le dashboard et Next Best Action - src/lib/finance.ts réexporte
// simplement ces deux fonctions pour ne pas casser les imports existants).
// ATTENTION : contrairement aux coûts prévisionnels (calculateForecastCosts),
// on n'exclut PAS les sorties déjà représentées dans les postes de travaux -
// "argent bloqué" est une notion de trésorerie non soldée, indépendante de
// la baseline de coût prévisionnel des postes.

export type MontantBloqueDetail = { origine: string; montantCts: number };
export type MontantBloque = { montantBloqueCts: number; details: MontantBloqueDetail[] };

/**
 * Montant potentiellement bloqué sur un dossier : reste à percevoir (toutes
 * entrées, détaillées ou repli legacy, via getEntreeLignesForDossier) plus
 * reste à payer (toutes sorties non soldées). Ne double-compte jamais.
 */
export async function calculateBlockedAmountForDossier(dossierId: string): Promise<MontantBloque> {
  const details: MontantBloqueDetail[] = [];

  const entreeLignes = await getEntreeLignesForDossier(dossierId);
  for (const l of entreeLignes) {
    if (l.resteCts > 0) details.push({ origine: l.categorieLabel, montantCts: l.resteCts });
  }

  const sorties = await prisma.mouvementFinancier.findMany({ where: { dossierId, type: "SORTIE", statut: { not: "ANNULE" } } });
  for (const m of sorties) {
    if (isSettled(m)) continue;
    const montant = getRemainingAmount(m);
    if (montant > 0) details.push({ origine: categorieMouvementLabels[m.categorie], montantCts: montant });
  }

  const montantBloqueCts = details.reduce((sum, d) => sum + d.montantCts, 0);
  return { montantBloqueCts, details };
}

export type MontantBloqueParFlux = {
  flux: "ANAH" | "CEE" | "CLIENT" | "AUTRE";
  label: string;
  nombreDossiers: number;
  montantBloqueCts: number;
};

/**
 * Agrège le montant bloqué de tous les dossiers actifs d'une organisation,
 * par flux (ANAH/CEE/Client/Autre) - même couche centrale que
 * calculateBlockedAmountForDossier, jamais de logique dupliquée.
 */
export async function calculateBlockedAmountByFlux(organisationId: string): Promise<MontantBloqueParFlux[]> {
  const groupes: Record<"ANAH" | "CEE" | "CLIENT" | "AUTRE", { dossiers: Set<string>; montantCts: number }> = {
    ANAH: { dossiers: new Set(), montantCts: 0 },
    CEE: { dossiers: new Set(), montantCts: 0 },
    CLIENT: { dossiers: new Set(), montantCts: 0 },
    AUTRE: { dossiers: new Set(), montantCts: 0 },
  };

  const entreeLignes = await getEntreeLignesForOrganisation(organisationId);
  for (const l of entreeLignes) {
    if (l.resteCts <= 0) continue;
    const flux = l.flux === "MPR" ? "ANAH" : l.flux;
    groupes[flux].dossiers.add(l.dossierId);
    groupes[flux].montantCts += l.resteCts;
  }

  const dossiersActifs = await prisma.dossier.findMany({ where: { organisationId, statut: { key: { not: "CLOTURE" } } }, select: { id: true } });
  const sorties = await prisma.mouvementFinancier.findMany({
    where: { organisationId, dossierId: { in: dossiersActifs.map((d) => d.id) }, type: "SORTIE", statut: { not: "ANNULE" } },
  });
  for (const m of sorties) {
    if (isSettled(m)) continue;
    const montant = getRemainingAmount(m);
    if (montant > 0) {
      groupes.AUTRE.dossiers.add(m.dossierId);
      groupes.AUTRE.montantCts += montant;
    }
  }

  return [
    { flux: "ANAH", label: "ANAH / MPR", nombreDossiers: groupes.ANAH.dossiers.size, montantBloqueCts: groupes.ANAH.montantCts },
    { flux: "CEE", label: "CEE", nombreDossiers: groupes.CEE.dossiers.size, montantBloqueCts: groupes.CEE.montantCts },
    { flux: "CLIENT", label: "Client", nombreDossiers: groupes.CLIENT.dossiers.size, montantBloqueCts: groupes.CLIENT.montantCts },
    { flux: "AUTRE", label: "Autre (coûts, commissions)", nombreDossiers: groupes.AUTRE.dossiers.size, montantBloqueCts: groupes.AUTRE.montantCts },
  ];
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
