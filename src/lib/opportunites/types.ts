import type { TypeTravaux, TypeRdv, Precarite, TypeOccupant, ZoneClimatique } from "@/generated/prisma/enums";
import type { AnswerValue } from "@/lib/questionnaire/engine";
import type { NbqQuestion } from "@/lib/next-best-question/engine";

// ============================================================
// Types du Moteur Opportunités (P14). CONTRAT VOLONTAIREMENT FERMÉ :
// OpportuniteDetectee ne contient AUCUN champ de CA/marge/RAC/économie -
// ce moteur détecte et classe, il ne calcule JAMAIS ces valeurs (audit
// section G/H, P7 décide du réglementaire, P8 construit les scénarios).
// ============================================================

export type NiveauPertinence = "FORTE" | "A_ETUDIER" | "FAIBLE" | "NON_PERTINENT";

export type StatutEligibilitePotentielle = "A_CONFIRMER" | "DONNEES_INSUFFISANTES" | "NON_APPLICABLE";

export type ProgrammeRef = { id: string; code: string; nom: string };
export type RegleReglementaireRef = { id: string; code: string; nom: string };

export type OpportuniteDetectee = {
  typeTravaux: TypeTravaux;
  ficheMetierId: string;
  ficheMetierCode: string;
  libelle: string;
  score: number;
  niveau: NiveauPertinence;
  raisonsPositives: string[];
  raisonsNegatives: string[];
  informationsManquantes: string[];
  statutEligibilitePotentielle: StatutEligibilitePotentielle;
  programmesATester: ProgrammeRef[];
  reglesReglementairesATester: RegleReglementaireRef[];
  prochaineAction: string | null;
  typeRdvRecommande: TypeRdv | null;
};

export type FicheMetierCondition = { questionCode: string; valeurAttendue: string };

export type FicheMetierInput = {
  id: string;
  typeTravaux: TypeTravaux;
  code: string;
  libelle: string;
  actif: boolean;
  ordre: number;
  conditionsActivation: FicheMetierCondition[];
  donneesNecessairesEligibilite: string[];
  prochaineAction: string | null;
  typeRdvRecommande: TypeRdv | null;
  programmes: ProgrammeRef[];
  reglesReglementaires: RegleReglementaireRef[];
};

export type OpportunitesClientInput = {
  precarite: Precarite | null;
  typeOccupant: TypeOccupant | null;
  nombrePersonnesFoyer: number | null;
  revenuFiscalReference: number | null;
  zoneClimatique: ZoneClimatique | null;
};

export type OpportunitesInput = {
  client: OpportunitesClientInput;
  // Réponses déjà données au questionnaire, indexées par code de question -
  // utilisées UNIQUEMENT pour évaluer FicheMetier.conditionsActivation
  // (même comparateur que le moteur questionnaire, jamais un second
  // langage de règles).
  reponses: Record<string, AnswerValue>;
  // Sous-ensemble des questions nécessaires à l'interprétation des
  // conditions (code, type - pour answerMatchesValue).
  questions: Pick<NbqQuestion, "code" | "type">[];
  // Noms de champs réels déjà connus (convention "Logement.xxx"/
  // "Client.xxx") - sert à calculer informationsManquantes.
  champsConnus: Set<string>;
  besoinPrincipal?: string | null;
  fichesMetier: FicheMetierInput[];
};

export type OpportunitesResult = {
  opportunites: OpportuniteDetectee[];
  generatedAt: Date;
};
