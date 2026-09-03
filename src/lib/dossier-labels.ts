import type {
  Precarite,
  TypeTache,
  StatutTache,
  TypeTravaux,
  TypeDocument,
  TypeMouvementFinancier,
  CategorieMouvementFinancier,
  StatutMouvementFinancier,
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
  RACCORDEMENT_RESEAU_CHALEUR: "Raccordement à un réseau de chaleur/froid",
  CHAUFFE_EAU_THERMODYNAMIQUE: "Chauffe-eau thermodynamique",
  PAC_AIR_EAU: "PAC air/eau",
  PAC_AIR_AIR: "PAC air/air",
  PAC_GEOTHERMIQUE_SOLAROTHERMIQUE: "PAC géothermique ou solarothermique",
  CHAUFFE_EAU_SOLAIRE_INDIVIDUEL: "Chauffe-eau solaire individuel",
  CHAUFFAGE_SOLAIRE_COMBINE: "Chauffage solaire combiné",
  PVT_EAU: "PVT eau (partie thermique)",
  POELE_BUCHES: "Poêle à bûches",
  POELE_GRANULES: "Poêle à granulés",
  CHAUDIERE_BOIS_MANUELLE: "Chaudière bois manuelle (bûches)",
  CHAUDIERE_BOIS_AUTOMATIQUE: "Chaudière bois automatique (granulés)",
  FOYER_FERME_INSERT: "Foyer fermé / insert",
  ITE: "ITE (isolation murs extérieur)",
  ITI: "ITI (isolation murs intérieur)",
  COMBLES: "Isolation combles perdus",
  RAMPANTS: "Isolation rampants de toiture",
  TOITURE_TERRASSE: "Isolation toiture-terrasse",
  PAROIS_VITREES: "Parois vitrées (fenêtres)",
  AUDIT_ENERGETIQUE: "Audit énergétique",
  DEPOSE_CUVE_FIOUL: "Dépose de cuve à fioul",
  VMC: "VMC double flux",
  BALLON_THERMODYNAMIQUE: "Ballon thermodynamique",
  AUTRE: "Autre",
};

export const typeDocumentLabels: Record<TypeDocument, string> = {
  DEVIS: "Devis",
  AUDIT: "Audit",
  PHOTO_VISITE: "Photo de visite",
  PHOTO_CHANTIER: "Photo de chantier",
  AUTRE: "Autre",
};

export const typeMouvementLabels: Record<TypeMouvementFinancier, string> = {
  ENTREE: "Entrée",
  SORTIE: "Sortie",
};

export const categorieMouvementLabels: Record<CategorieMouvementFinancier, string> = {
  ENCAISSEMENT_CLIENT: "Encaissement client",
  ENCAISSEMENT_ANAH: "Encaissement ANAH",
  ENCAISSEMENT_MPR: "Encaissement MPR",
  ENCAISSEMENT_CEE: "Encaissement CEE",
  PAIEMENT_SOUS_TRAITANT: "Paiement sous-traitant",
  PAIEMENT_FOURNISSEUR: "Paiement fournisseur",
  COMMISSION_COMMERCIALE: "Commission commerciale",
  COMMISSION_REGIE: "Commission régie",
  COMMISSION_APPORTEUR: "Commission apporteur",
  AUTRE_ENTREE: "Autre entrée",
  AUTRE_SORTIE: "Autre sortie",
};

export const statutMouvementLabels: Record<StatutMouvementFinancier, string> = {
  PREVU: "Prévu",
  A_RECEVOIR: "À recevoir",
  A_PAYER: "À payer",
  PARTIEL: "Partiel",
  RECU: "Reçu",
  PAYE: "Payé",
  ANNULE: "Annulé",
  EN_RETARD: "En retard",
};

export function resteAChargeCents(dossier: {
  montantDevisTTC: number;
  montantAideMPR: number;
  montantAideCEE: number;
}): number {
  return dossier.montantDevisTTC - dossier.montantAideMPR - dossier.montantAideCEE;
}
