import type {
  TypeDossier,
  StatutDossier,
  ModePaiementAide,
  Precarite,
  TypeTache,
  StatutTache,
} from "@/generated/prisma/enums";

export const typeDossierLabels: Record<TypeDossier, string> = {
  RENOVATION_AMPLEUR_ANAH: "Rénovation d'ampleur (ANAH)",
  RENOVATION_AMPLEUR_CEE: "Rénovation d'ampleur (CEE seul)",
  MONOGESTE: "Monogeste",
};

export const statutDossierLabels: Record<StatutDossier, string> = {
  DEVIS_SIGNE: "Devis signé",
  AUDIT_FAIT: "Audit fait",
  DOSSIER_DEPOSE: "Dossier déposé",
  EN_INSTRUCTION: "En instruction",
  ACCEPTE: "Accepté",
  REFUSE: "Refusé",
  TRAVAUX_PLANIFIES: "Travaux planifiés",
  TRAVAUX_EN_COURS: "Travaux en cours",
  TRAVAUX_TERMINES: "Travaux terminés",
  CONTROLE_EN_COURS: "Contrôle en cours",
  SOLDE_DEMANDE: "Solde demandé",
  SOLDE_RECU: "Solde reçu",
  CLOTURE: "Clôturé",
};

export const modePaiementLabels: Record<ModePaiementAide, string> = {
  CLIENT_AVANCE: "Client avance",
  AVANCE_30_ANAH: "Avance 30% ANAH",
  FINANCEMENT_PARTENAIRE: "Financement partenaire",
  MANDATAIRE_FINANCIER_BHM: "Mandataire BHM",
  MANDATAIRE_FINANCIER_ANAH: "Mandataire financier ANAH",
};

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
