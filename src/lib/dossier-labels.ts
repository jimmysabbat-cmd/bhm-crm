import type {
  Precarite,
  TypeTache,
  StatutTache,
  TypeTravaux,
  TypeDocument,
} from "@/generated/prisma/enums";

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

export const typeTravauxLabels: Record<TypeTravaux, string> = {
  ITE: "ITE (isolation par l'extérieur)",
  COMBLES: "Combles",
  PAC_AIR_EAU: "PAC air/eau",
  BALLON_THERMODYNAMIQUE: "Ballon thermodynamique",
  VMC: "VMC",
  AUTRE: "Autre",
};

export const typeDocumentLabels: Record<TypeDocument, string> = {
  DEVIS: "Devis",
  AUDIT: "Audit",
  PHOTO_VISITE: "Photo de visite",
  PHOTO_CHANTIER: "Photo de chantier",
  AUTRE: "Autre",
};

export function resteAChargeCents(dossier: {
  montantDevisTTC: number;
  montantAideMPR: number;
  montantAideCEE: number;
}): number {
  return dossier.montantDevisTTC - dossier.montantAideMPR - dossier.montantAideCEE;
}
