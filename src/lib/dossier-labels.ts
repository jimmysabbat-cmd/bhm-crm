import type { Precarite, TypeTache, StatutTache } from "@/generated/prisma/enums";

export const precariteLabels: Record<Precarite, string> = {
  TRES_MODESTE: "Très modeste",
  MODESTE: "Modeste",
  INTERMEDIAIRE: "Intermédiaire",
  SUPERIEUR: "Supérieur",
};

export const typeTacheLabels: Record<TypeTache, string> = {
  RELANCE_CLIENT: "Relance client",
  RELANCE_CEE: "Relance CEE",
  RELANCE_ANAH: "Relance ANAH",
  RELANCE_FOURNISSEUR: "Relance fournisseur",
  RELANCE_SOUS_TRAITANT: "Relance sous-traitant",
  AUTRE: "Autre",
};

export const statutTacheLabels: Record<StatutTache, string> = {
  A_FAIRE: "À faire",
  FAIT: "Fait",
  ANNULE: "Annulé",
};

export function resteAChargeCents(dossier: {
  montantDevisTTC: number;
  montantAideMPR: number;
  montantAideCEE: number;
}): number {
  return dossier.montantDevisTTC - dossier.montantAideMPR - dossier.montantAideCEE;
}
