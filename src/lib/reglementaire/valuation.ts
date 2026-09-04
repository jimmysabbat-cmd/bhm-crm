import { prisma } from "@/lib/prisma";

// ============================================================
// Valorisation CEE (P7, section 13/14/15/16) - couche SÉPARÉE du calcul
// réglementaire : kWh cumac ≠ valeur €. Un même kWh cumac peut valoir des
// montants différents selon le délégataire, la catégorie (précarité) et la
// période - ce sont des taux COMMERCIAUX négociés par l'organisation,
// jamais une donnée réglementaire officielle.
// ============================================================

export type CeeValuationResult = {
  mwhc: number;
  tauxCtsParMwhc: number;
  primeCts: number;
  sourceTarifId: string;
  delegataireId: string;
  delegataireNom: string;
  categorie: string;
  dateDebutValidite: Date;
  dateFinValidite: Date | null;
  delaiPaiementJours: number | null;
};

async function findApplicableTarif(params: {
  organisationId: string;
  delegataireId: string;
  ficheCode: string;
  categorie: string;
  date: Date;
}) {
  const whereCommun = {
    organisationId: params.organisationId,
    delegataireId: params.delegataireId,
    categorie: params.categorie,
    actif: true,
    dateDebut: { lte: params.date },
    OR: [{ dateFin: null }, { dateFin: { gte: params.date } }],
  };

  // Un tarif propre à la fiche prime sur un tarif générique (ficheCode null).
  const specifique = await prisma.tarifDelegataireCee.findFirst({
    where: { ...whereCommun, ficheCode: params.ficheCode },
    include: { delegataire: true },
    orderBy: { dateDebut: "desc" },
  });
  if (specifique) return specifique;

  return prisma.tarifDelegataireCee.findFirst({
    where: { ...whereCommun, ficheCode: null },
    include: { delegataire: true },
    orderBy: { dateDebut: "desc" },
  });
}

/**
 * calculateCeeValuation (section 15) : convertit un kWh cumac en prime en
 * centimes selon un tarif délégataire réellement configuré. Retourne null
 * si aucun tarif applicable n'existe (jamais un montant inventé).
 */
export async function calculateCeeValuation(params: {
  organisationId: string;
  kwhCumac: number;
  delegataireId: string;
  ficheCode: string;
  categorie: string;
  date: Date;
}): Promise<CeeValuationResult | null> {
  const tarif = await findApplicableTarif(params);
  if (!tarif) return null;

  const mwhc = params.kwhCumac / 1000;
  // tauxCtsParMwhc est un entier (centimes par MWhc) - le seul flottant
  // introduit est mwhc (kWh/1000), immédiatement remultiplié puis arrondi à
  // l'entier le plus proche pour rester un montant monétaire Int cents.
  const primeCts = Math.round(mwhc * tarif.tauxCtsParMwhc);

  return {
    mwhc,
    tauxCtsParMwhc: tarif.tauxCtsParMwhc,
    primeCts,
    sourceTarifId: tarif.id,
    delegataireId: tarif.delegataireId,
    delegataireNom: tarif.delegataire.nom,
    categorie: tarif.categorie,
    dateDebutValidite: tarif.dateDebut,
    dateFinValidite: tarif.dateFin,
    delaiPaiementJours: tarif.delaiPaiementJours,
  };
}

export type CeeDelegateComparison = CeeValuationResult & {
  // Score V1 volontairement simple (section 16) : combine uniquement la
  // valeur financière et le délai de paiement, les deux seules données
  // objectivement disponibles aujourd'hui. scoreQualiteAdministrative est
  // préparé pour plus tard (section 17) mais jamais fabriqué sans données
  // réelles (taux de rejet, historique...).
  scoreSimple: number;
  scoreQualiteAdministrative: null;
};

function scoreSimple(v: { primeCts: number; delaiPaiementJours: number | null }): number {
  // Pénalité de 100 cts par jour de délai (calibrage simple et documenté,
  // pas une vérité absolue) ; un délai inconnu est pénalisé prudemment
  // comme 60 jours plutôt que favorisé.
  const delai = v.delaiPaiementJours ?? 60;
  return v.primeCts - delai * 100;
}

/**
 * compareCeeDelegates (section 16) : compare tous les délégataires actifs
 * ayant un tarif configuré pour cette fiche/catégorie/date, triés par
 * score V1 décroissant.
 */
export async function compareCeeDelegates(params: {
  organisationId: string;
  kwhCumac: number;
  ficheCode: string;
  categorie: string;
  date: Date;
}): Promise<CeeDelegateComparison[]> {
  const delegataires = await prisma.delegataireCee.findMany({ where: { actif: true, organisationId: params.organisationId } });

  const resultats: CeeDelegateComparison[] = [];
  for (const d of delegataires) {
    const valuation = await calculateCeeValuation({
      organisationId: params.organisationId,
      kwhCumac: params.kwhCumac,
      delegataireId: d.id,
      ficheCode: params.ficheCode,
      categorie: params.categorie,
      date: params.date,
    });
    if (valuation) {
      resultats.push({ ...valuation, scoreSimple: scoreSimple(valuation), scoreQualiteAdministrative: null });
    }
  }

  resultats.sort((a, b) => b.scoreSimple - a.scoreSimple);
  return resultats;
}
