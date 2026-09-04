// ============================================================
// calculateLeadQualification() (P9, section 11) - score commercial
// déterministe, jamais d'IA. Volontairement DISTINCT du résultat de
// l'étude réglementaire P8 (section 12) : un lead peut être commercialement
// très qualifié (bon profil, logement complet, RDV pris) sans qu'aucune
// éligibilité CEE/MPR n'ait encore été calculée, et inversement.
// ============================================================

export type LeadQualificationStatus = "INSUFFISANT" | "PARTIEL" | "SUFFISANT";

export type LeadQualificationInput = {
  pipelineStatutKey: string;
  temperature: "FROID" | "TIEDE" | "CHAUD";
  aRdvPlanifie: boolean;
  logement: {
    typeBatiment: string | null;
    surfaceHabitableM2: number | null;
    anneeConstruction: number | null;
    chauffagePrincipal: string | null;
  } | null;
  nbReponsesQuestionnaire: number;
  nbQuestionsObligatoiresTotal: number;
  nbQuestionsObligatoiresRepondues: number;
};

export type LeadQualificationResult = {
  score: number;
  statut: LeadQualificationStatus;
  reasons: string[];
  missingFields: string[];
  recommendedNextAction: string;
};

export function calculateLeadQualification(input: LeadQualificationInput): LeadQualificationResult {
  const reasons: string[] = [];
  const missingFields: string[] = [];
  let score = 0;

  // Contact / logement de base (jusqu'à 30 points)
  if (input.logement?.typeBatiment) {
    score += 5;
    reasons.push("Type de bâtiment connu");
  } else missingFields.push("logement.typeBatiment");

  if (input.logement?.surfaceHabitableM2) {
    score += 10;
    reasons.push("Surface habitable connue");
  } else missingFields.push("logement.surfaceHabitableM2");

  if (input.logement?.anneeConstruction) {
    score += 5;
    reasons.push("Année de construction connue");
  } else missingFields.push("logement.anneeConstruction");

  if (input.logement?.chauffagePrincipal) {
    score += 10;
    reasons.push("Chauffage principal connu");
  } else missingFields.push("logement.chauffagePrincipal");

  // Questionnaire (jusqu'à 30 points, proportionnel aux questions
  // obligatoires réellement répondues)
  if (input.nbQuestionsObligatoiresTotal > 0) {
    const ratio = input.nbQuestionsObligatoiresRepondues / input.nbQuestionsObligatoiresTotal;
    score += Math.round(ratio * 30);
    reasons.push(`${input.nbQuestionsObligatoiresRepondues}/${input.nbQuestionsObligatoiresTotal} question(s) obligatoire(s) répondue(s)`);
    if (ratio < 1) missingFields.push("questionnaire.questionsObligatoires");
  } else if (input.nbReponsesQuestionnaire === 0) {
    missingFields.push("questionnaire.aucuneReponse");
  }

  // Engagement commercial (jusqu'à 30 points)
  if (input.aRdvPlanifie) {
    score += 20;
    reasons.push("RDV planifié");
  }
  if (input.temperature === "CHAUD") {
    score += 10;
    reasons.push("Température CHAUD");
  } else if (input.temperature === "FROID") {
    score -= 10;
    reasons.push("Température FROID");
  }

  const statutsBloquants = ["PERDU", "INJOIGNABLE"];
  if (statutsBloquants.includes(input.pipelineStatutKey)) {
    score = Math.min(score, 0);
    reasons.push(`Statut pipeline bloquant (${input.pipelineStatutKey})`);
  }

  score = Math.max(0, Math.min(100, score));

  let statut: LeadQualificationStatus;
  let recommendedNextAction: string;
  if (statutsBloquants.includes(input.pipelineStatutKey)) {
    statut = "INSUFFISANT";
    recommendedNextAction = "Aucune action - lead non poursuivi.";
  } else if (missingFields.includes("logement.surfaceHabitableM2") || missingFields.includes("logement.chauffagePrincipal")) {
    statut = "INSUFFISANT";
    recommendedNextAction = "Compléter la fiche logement (surface, chauffage) avant de poursuivre.";
  } else if (missingFields.includes("questionnaire.questionsObligatoires") || missingFields.includes("questionnaire.aucuneReponse")) {
    statut = "PARTIEL";
    recommendedNextAction = "Terminer le questionnaire de qualification.";
  } else if (!input.aRdvPlanifie) {
    statut = "PARTIEL";
    recommendedNextAction = "Planifier un RDV ou lancer une simulation d'étude.";
  } else {
    statut = "SUFFISANT";
    recommendedNextAction = "Lancer la simulation d'étude (P8).";
  }

  return { score, statut, reasons, missingFields, recommendedNextAction };
}
