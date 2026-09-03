import type { StudyDataQuality, StudyScenario, ScenarioScore, ScenarioRecommandation } from "./types";

// ============================================================
// Scoring + recommandation (P8, section 14/15/16).
//
// Déterministe, explicable, jamais une boîte noire (section 33 : pas
// d'appel IA/LLM dans ce moteur - uniquement des règles nommées avec un
// reasons[] structuré). Aucun poids "magique" caché : chaque composante du
// score est documentée dans reasons[].
// ============================================================

/**
 * scoreScenario (section 14) : combine marge, éligibilité, reste à charge,
 * besoin de trésorerie, délai d'encaissement, qualité des données du
 * dossier, données manquantes et risques identifiés. Chaque composante
 * ajoute un reason explicite.
 */
export function scoreScenario(scenario: StudyScenario, dataQuality: StudyDataQuality): ScenarioScore {
  const reasons: string[] = [];
  let score = 0;

  // Marge prévisionnelle (jusqu'à ±40 points)
  if (scenario.margin.confidence !== "NON_CALCULABLE" && scenario.margin.margePct !== null) {
    const margeScore = Math.max(Math.min(Math.round(scenario.margin.margePct), 40), -20);
    score += margeScore;
    reasons.push(`Marge prévisionnelle ${scenario.margin.margePct.toFixed(0)} %`);
    if (scenario.margin.confidence === "ESTIMATION_INCOMPLETE") {
      score -= 10;
      reasons.push("Marge basée sur des coûts incomplets (pénalité de confiance)");
    }
  } else {
    reasons.push("Marge non calculable (CA contractuel inconnu)");
  }

  // Statut éligibilité (jusqu'à ±30 points)
  const eligibiliteScores: Record<string, number> = {
    ELIGIBLE: 20,
    ELIGIBLE_PROBABLE: 15,
    A_CONFIRMER: 5,
    NON_ELIGIBLE: -30,
    BLOQUE: -30,
    DONNEES_INSUFFISANTES: -10,
  };
  if (scenario.statutEligibilite) {
    score += eligibiliteScores[scenario.statutEligibilite] ?? 0;
    reasons.push(`Statut éligibilité : ${scenario.statutEligibilite}`);
  }

  // Reste à charge client relatif au CA (jusqu'à 15 points, moins = mieux)
  if (scenario.resteAChargeClientCts !== null && scenario.caContractuelCts > 0) {
    const ratio = scenario.resteAChargeClientCts / scenario.caContractuelCts;
    const resteScore = Math.round((1 - Math.min(ratio, 1)) * 15);
    score += resteScore;
    reasons.push(`Reste à charge client : ${(ratio * 100).toFixed(0)} % du CA`);
  } else {
    reasons.push("Reste à charge client non déterminable");
  }

  // Besoin de trésorerie relatif au CA (jusqu'à -15 points)
  if (scenario.cashRequirement.montantAAvancerCts !== null && scenario.caContractuelCts > 0) {
    const ratio = scenario.cashRequirement.montantAAvancerCts / scenario.caContractuelCts;
    const tresoScore = -Math.round(Math.min(ratio, 1) * 15);
    score += tresoScore;
    reasons.push(`Besoin de trésorerie estimé : ${(ratio * 100).toFixed(0)} % du CA`);
  }

  // Délai d'encaissement (jusqu'à -10 points, plus long = pire)
  if (scenario.delaiEncaissement.estimable && scenario.delaiEncaissement.joursEstimes !== null) {
    const delaiScore = -Math.round(Math.min(scenario.delaiEncaissement.joursEstimes / 10, 10));
    score += delaiScore;
    reasons.push(`Délai d'encaissement estimé : ${scenario.delaiEncaissement.joursEstimes} jours`);
  } else {
    reasons.push("Délai d'encaissement non estimable");
  }

  // Qualité des données du dossier (jusqu'à ±10 points)
  const qualiteScores: Record<StudyDataQuality, number> = { COMPLETE: 10, GOOD: 6, PARTIAL: 2, INSUFFICIENT: -10 };
  score += qualiteScores[dataQuality];
  reasons.push(`Qualité des données du dossier : ${dataQuality}`);

  // Données manquantes propres au scénario (-2 par champ, plafonné -20)
  if (scenario.missingFields.length > 0) {
    const penalite = Math.min(scenario.missingFields.length * 2, 20);
    score -= penalite;
    reasons.push(`${scenario.missingFields.length} donnée(s) manquante(s) pour ce scénario`);
  }

  // Risques identifiés (-5 chacun, plafonné -20)
  if (scenario.risques.length > 0) {
    const penalite = Math.min(scenario.risques.length * 5, 20);
    score -= penalite;
    reasons.push(`${scenario.risques.length} risque(s) identifié(s)`);
  }

  return { score, reasons };
}

/**
 * recommendScenario (section 16) : recommandation déterministe, jamais
 * "certaine" quand les données ne le permettent pas.
 */
export function recommendScenario(scenario: StudyScenario): { recommandation: ScenarioRecommandation; reasons: string[] } {
  const reasons: string[] = [];

  if (scenario.margin.confidence === "NON_CALCULABLE" || scenario.caContractuelCts === 0) {
    reasons.push("CA contractuel inconnu : impossible d'évaluer ce scénario économiquement.");
    return { recommandation: "IMPOSSIBLE_A_EVALUER", reasons };
  }

  if (scenario.statutEligibilite === "NON_ELIGIBLE" || scenario.statutEligibilite === "BLOQUE") {
    reasons.push("Éligibilité non favorable pour ce scénario.");
    return { recommandation: "NON_RECOMMANDE", reasons };
  }

  if (scenario.statutEligibilite === "DONNEES_INSUFFISANTES" || scenario.missingFields.length >= 3) {
    reasons.push("Trop de données manquantes pour se prononcer avec confiance.");
    return { recommandation: "A_CONFIRMER", reasons };
  }

  if (scenario.margin.confidence === "ESTIMATION_INCOMPLETE" || scenario.risques.length > 0) {
    reasons.push("Marge ou éléments du scénario reposent sur des données incomplètes : à confirmer avant engagement.");
    return { recommandation: "RISQUE", reasons };
  }

  const margePct = scenario.margin.margePct ?? 0;
  const eligibiliteFavorable = scenario.statutEligibilite === "ELIGIBLE" || scenario.statutEligibilite === "ELIGIBLE_PROBABLE" || scenario.statutEligibilite === null;

  if (margePct >= 30 && eligibiliteFavorable) {
    reasons.push(`Marge prévisionnelle élevée (${margePct.toFixed(0)} %) et éligibilité favorable.`);
    return { recommandation: "RECOMMANDE", reasons };
  }
  if (margePct >= 15) {
    reasons.push(`Marge prévisionnelle correcte (${margePct.toFixed(0)} %).`);
    return { recommandation: "INTERESSANT", reasons };
  }

  reasons.push(`Marge prévisionnelle faible ou négative (${margePct.toFixed(0)} %).`);
  return { recommandation: "RISQUE", reasons };
}

/** Applique scoreScenario + recommendScenario à une liste de scénarios (renvoie de nouveaux objets, n'écrit rien). */
export function scoreAndRecommendScenarios(scenarios: StudyScenario[], dataQuality: StudyDataQuality): StudyScenario[] {
  return scenarios.map((scenario) => {
    const score = scoreScenario(scenario, dataQuality);
    const { recommandation, reasons } = recommendScenario(scenario);
    return { ...scenario, score, recommandation, recommandationReasons: reasons };
  });
}

/**
 * Détermine le scénario à mettre en avant, SANS jamais prétendre à une
 * "meilleure solution" certaine (section 15) - le libellé reste toujours
 * prudent, quelle que soit la qualité des données.
 */
export function pickRecommendedScenario(scenarios: StudyScenario[]): { scenarioId: string | null; label: string } {
  if (scenarios.length === 0) {
    return { scenarioId: null, label: "Aucun scénario disponible." };
  }
  const sorted = [...scenarios].sort((a, b) => b.score.score - a.score.score);
  return { scenarioId: sorted[0].id, label: "Scénario actuellement le plus favorable selon les données disponibles." };
}
