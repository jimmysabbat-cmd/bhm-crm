import { prisma } from "@/lib/prisma";
import { resteAChargeCents, categorieMouvementLabels } from "@/lib/dossier-labels";
import type { StatutMouvementFinancier } from "@/generated/prisma/enums";

const STATUTS_MOUVEMENT_TERMINAUX: StatutMouvementFinancier[] = ["RECU", "PAYE", "ANNULE"];

// Catégories déjà couvertes par les compteurs agrégés du Dossier
// (montantAideMPR/CEE, montantEncaisse*) - ne jamais les recompter aussi
// via MouvementFinancier tant que celui-ci n'est pas la source de vérité
// unique (cf. section 5/6 du prompt P3 : coexistence assumée pour l'instant).
export const CATEGORIES_COUVERTES_PAR_AGREGATS = new Set([
  "ENCAISSEMENT_CLIENT",
  "ENCAISSEMENT_ANAH",
  "ENCAISSEMENT_MPR",
  "ENCAISSEMENT_CEE",
]);

export function mouvementIsLate(mouvement: {
  statut: StatutMouvementFinancier;
  datePrevue: Date | null;
}): boolean {
  if (!mouvement.datePrevue) return false;
  if (STATUTS_MOUVEMENT_TERMINAUX.includes(mouvement.statut)) return false;
  return mouvement.datePrevue.getTime() < Date.now();
}

export function mouvementJoursRetard(mouvement: {
  statut: StatutMouvementFinancier;
  datePrevue: Date | null;
}): number {
  if (!mouvementIsLate(mouvement) || !mouvement.datePrevue) return 0;
  return Math.floor((Date.now() - mouvement.datePrevue.getTime()) / 86_400_000);
}

export type MontantBloqueDetail = {
  origine: string;
  montantCts: number;
};

export type MontantBloque = {
  montantBloqueCts: number;
  details: MontantBloqueDetail[];
};

/**
 * Calcule le montant potentiellement bloqué sur un dossier, de façon
 * prudente et explicable : reste à percevoir (MPR/ANAH, CEE, client) depuis
 * les compteurs agrégés du dossier, plus les mouvements financiers non
 * couverts par ces agrégats (coûts, commissions...) encore non soldés.
 * Ne double-compte jamais : un même euro n'apparaît que dans une seule
 * ligne de détail.
 */
export async function calculateBlockedAmountForDossier(dossierId: string): Promise<MontantBloque> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      montantDevisTTC: true,
      montantAideMPR: true,
      montantAideCEE: true,
      montantEncaisseClient: true,
      montantEncaisseMPR: true,
      montantEncaisseCEE: true,
    },
  });
  if (!dossier) return { montantBloqueCts: 0, details: [] };

  const details: MontantBloqueDetail[] = [];

  const resteMPR = dossier.montantAideMPR - dossier.montantEncaisseMPR;
  if (resteMPR > 0) details.push({ origine: "ANAH / MPR attendu", montantCts: resteMPR });

  const resteCEE = dossier.montantAideCEE - dossier.montantEncaisseCEE;
  if (resteCEE > 0) details.push({ origine: "CEE attendu", montantCts: resteCEE });

  const resteClient = resteAChargeCents(dossier) - dossier.montantEncaisseClient;
  if (resteClient > 0) details.push({ origine: "Client restant", montantCts: resteClient });

  const mouvementsNonCouverts = await prisma.mouvementFinancier.findMany({
    where: {
      dossierId,
      statut: { notIn: STATUTS_MOUVEMENT_TERMINAUX },
      categorie: { notIn: Array.from(CATEGORIES_COUVERTES_PAR_AGREGATS) as never[] },
    },
  });
  for (const m of mouvementsNonCouverts) {
    const montant = m.montantReelCts ?? m.montantPrevuCts ?? 0;
    if (montant > 0) {
      details.push({ origine: categorieMouvementLabels[m.categorie], montantCts: montant });
    }
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
 * par flux. Ne retourne que ce qui est justifiable par les agrégats et
 * mouvements existants - aucun montant inventé.
 */
export async function calculateBlockedAmountByFlux(organisationId: string): Promise<MontantBloqueParFlux[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId, statut: { key: { not: "CLOTURE" } } },
    select: {
      id: true,
      montantDevisTTC: true,
      montantAideMPR: true,
      montantAideCEE: true,
      montantEncaisseClient: true,
      montantEncaisseMPR: true,
      montantEncaisseCEE: true,
    },
  });

  const anah = { nombreDossiers: 0, montantBloqueCts: 0 };
  const cee = { nombreDossiers: 0, montantBloqueCts: 0 };
  const client = { nombreDossiers: 0, montantBloqueCts: 0 };

  for (const d of dossiers) {
    const resteMPR = d.montantAideMPR - d.montantEncaisseMPR;
    if (resteMPR > 0) {
      anah.nombreDossiers += 1;
      anah.montantBloqueCts += resteMPR;
    }
    const resteCEE = d.montantAideCEE - d.montantEncaisseCEE;
    if (resteCEE > 0) {
      cee.nombreDossiers += 1;
      cee.montantBloqueCts += resteCEE;
    }
    const resteClient = resteAChargeCents(d) - d.montantEncaisseClient;
    if (resteClient > 0) {
      client.nombreDossiers += 1;
      client.montantBloqueCts += resteClient;
    }
  }

  const mouvementsAutres = await prisma.mouvementFinancier.findMany({
    where: {
      organisationId,
      statut: { notIn: STATUTS_MOUVEMENT_TERMINAUX },
      categorie: { notIn: Array.from(CATEGORIES_COUVERTES_PAR_AGREGATS) as never[] },
    },
    select: { dossierId: true, montantPrevuCts: true, montantReelCts: true },
  });
  const dossiersAutres = new Set<string>();
  let autreMontant = 0;
  for (const m of mouvementsAutres) {
    const montant = m.montantReelCts ?? m.montantPrevuCts ?? 0;
    if (montant > 0) {
      autreMontant += montant;
      dossiersAutres.add(m.dossierId);
    }
  }

  return [
    { flux: "ANAH", label: "ANAH / MPR", nombreDossiers: anah.nombreDossiers, montantBloqueCts: anah.montantBloqueCts },
    { flux: "CEE", label: "CEE", nombreDossiers: cee.nombreDossiers, montantBloqueCts: cee.montantBloqueCts },
    { flux: "CLIENT", label: "Client", nombreDossiers: client.nombreDossiers, montantBloqueCts: client.montantBloqueCts },
    { flux: "AUTRE", label: "Autre (coûts, commissions)", nombreDossiers: dossiersAutres.size, montantBloqueCts: autreMontant },
  ];
}
