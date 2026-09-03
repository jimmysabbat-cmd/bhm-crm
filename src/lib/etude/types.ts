import type { Precarite, ZoneClimatique, TypeTravaux, StatutEligibiliteReglementaire } from "@/generated/prisma/enums";
import type { Confidence } from "@/lib/financial-engine";

// ============================================================
// Types du moteur d'étude (P8). Toute donnée potentiellement absente est
// modélisée via QualifiedField - jamais un champ silencieusement à 0 ou
// vide qui pourrait être confondu avec une vraie donnée connue (section 2
// du prompt P8 : "Le moteur doit distinguer données connues / absentes /
// estimées / confirmées").
// ============================================================

export type DataStatus = "CONNU" | "ABSENT" | "ESTIME" | "CONFIRME";

export type QualifiedField<T> = {
  value: T | null;
  status: DataStatus;
};

function connu<T>(value: T | null | undefined): QualifiedField<T> {
  return value === null || value === undefined ? { value: null, status: "ABSENT" } : { value, status: "CONNU" };
}

function absent<T>(): QualifiedField<T> {
  return { value: null, status: "ABSENT" };
}

export const qualified = { connu, absent };

// --- Client (section 2) ---
export type StudyClient = {
  nom: string;
  prenom: string;
  // Aucun champ "type occupant"/"composition ménage"/"revenu précis" dans
  // le schéma actuel : modélisés ABSENT plutôt qu'omis, pour que l'UI et le
  // calcul de qualité des données sachent explicitement qu'ils manquent.
  typeOccupant: QualifiedField<"PROPRIETAIRE" | "LOCATAIRE">;
  precarite: QualifiedField<Precarite>;
  revenuMenage: QualifiedField<number>;
  compositionMenage: QualifiedField<number>;
};

// --- Logement ---
export type StudyLogement = {
  adresse: QualifiedField<string>;
  typeBatiment: QualifiedField<"MAISON" | "APPARTEMENT">;
  surfaceHabitableM2: QualifiedField<number>;
  anneeConstruction: QualifiedField<number>;
  zoneClimatique: QualifiedField<ZoneClimatique>;
  chauffageExistant: QualifiedField<string>;
  ecs: QualifiedField<string>;
  nombreLogements: QualifiedField<number>;
  dpe: QualifiedField<string>;
};

// --- Projet : un poste de travaux, avec les variables réglementaires
// connues pour lui si sa fiche est migrée dans le moteur P7 ---
export type StudyProjectPoste = {
  posteId: string;
  typeTravaux: TypeTravaux;
  surfaceM2: QualifiedField<number>;
  etasBande: QualifiedField<"111a140" | "plus140">;
  puissance: QualifiedField<number>;
  coutHTCts: QualifiedField<number>;
  coutTTCCts: QualifiedField<number>;
  ficheReglementaireCode: string | null;
};

export type StudyProject = {
  postes: StudyProjectPoste[];
  dateEngagement: QualifiedField<Date>;
  delegataireCeeActuelId: string | null;
  dateDepotDelegataireCee: QualifiedField<Date>;
};

// --- Financier (réutilise financial-engine.ts, jamais recalculé en double) ---
export type StudyFinancial = {
  caContractuelCts: number;
  caSource: string;
  caConfidence: Confidence;
  coutsPrevusCts: number;
  costStatus: "COMPLETE" | "INCOMPLETE";
  coutsLimites: string[];
  aideMprConnueCts: number;
  aideCeeConnueCts: number;
  encaisseCts: number;
  resteAEncaisserCts: number;
};

// --- Variables réglementaires prêtes à être passées au moteur P7, par poste ---
export type StudyRegulatoryInputs = {
  posteId: string;
  ficheCode: string | null;
  inputs: Record<string, unknown>;
  missingFields: string[];
};

export type StudyDataQuality = "COMPLETE" | "GOOD" | "PARTIAL" | "INSUFFICIENT";

export type StudyContext = {
  organisationId: string;
  dossierId: string;
  dossierReference: string;
  client: StudyClient;
  logement: StudyLogement;
  project: StudyProject;
  financial: StudyFinancial;
  regulatoryInputs: StudyRegulatoryInputs[];
  dataQuality: StudyDataQuality;
  missingFields: string[];
  builtAt: Date;
};

// --- Scénario ---

export type ScenarioCostStatus = "COMPLETE" | "INCOMPLETE";
export type MarginConfidence = "FIABLE" | "ESTIMATION_INCOMPLETE" | "NON_CALCULABLE";

export type ScenarioMargin = {
  caCts: number;
  coutsCts: number;
  margeCts: number;
  margePct: number | null;
  confidence: MarginConfidence;
  missingFields: string[];
};

export type ScenarioCashRequirement = {
  montantAAvancerCts: number | null;
  principalesSortiesAvantEntree: { label: string; montantCts: number }[];
  premiereEntreeAttendue: { label: string; date: Date | null } | null;
  picDeBesoinCts: number | null;
  limites: string[];
};

export type ScenarioDelaiEncaissement = {
  estimable: boolean;
  dateEstimee: Date | null;
  joursEstimes: number | null;
  base: string | null;
};

export type ScenarioRecommandation = "RECOMMANDE" | "INTERESSANT" | "A_CONFIRMER" | "RISQUE" | "NON_RECOMMANDE" | "IMPOSSIBLE_A_EVALUER";

export type ScenarioScore = {
  score: number;
  reasons: string[];
};

export type ConfianceSourceReglementaire = "VERIFIED_SOURCE" | "UNVERIFIED_SOURCE";

export type ReglementaireProvenanceScenario = {
  ficheCode: string;
  ruleVersionId: string;
  numeroVersion: string;
  dateDebutEffet: Date;
  dateFinEffet: Date | null;
  sourceNom: string;
  provenance: string;
  confianceSource: ConfianceSourceReglementaire;
  avertissementSource: string | null;
};

export type StudyScenario = {
  id: string;
  titre: string;
  description: string;
  posteIds: string[];
  fichesReglementaires: ReglementaireProvenanceScenario[];
  statutEligibilite: StatutEligibiliteReglementaire | null;
  aides: { origine: string; montantCts: number }[];
  ceeKwhCumac: number | null;
  delegataireId: string | null;
  delegataireNom: string | null;
  valorisationCeeCts: number | null;
  delaiPaiementDelegataireJours: number | null;
  caContractuelCts: number;
  resteAChargeClientCts: number | null;
  coutsPrevusCts: number;
  costStatus: ScenarioCostStatus;
  margin: ScenarioMargin;
  cashRequirement: ScenarioCashRequirement;
  delaiEncaissement: ScenarioDelaiEncaissement;
  risques: string[];
  warnings: string[];
  missingFields: string[];
  reasons: string[];
  score: ScenarioScore;
  recommandation: ScenarioRecommandation;
  recommandationReasons: string[];
};

export type StudyMode = "SIMULATION" | "OFFICIEL";

export type StudyResult = {
  mode: StudyMode;
  context: StudyContext;
  scenarios: StudyScenario[];
  recommendedScenarioLabel: string;
  recommendedScenarioId: string | null;
  generatedAt: Date;
};
