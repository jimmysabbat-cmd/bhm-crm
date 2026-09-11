import { answerMatchesValue, type QuestionDef } from "@/lib/questionnaire/engine";
import type { OpportunitesInput, OpportunitesResult, OpportuniteDetectee, NiveauPertinence, FicheMetierInput } from "./types";

// ============================================================
// Moteur Opportunités (P14) - fonctions pures. Détecte et classe les
// métiers/prestations pertinents à partir des données déjà collectées,
// SANS jamais calculer CA/marge/RAC/économie (audit section G) : ce
// contrat est garanti par le type de retour (OpportuniteDetectee), qui ne
// déclare aucun de ces champs. P7 décide du réglementaire (via
// programmesATester/reglesReglementairesATester, simples références - la
// résolution réelle reste dans src/lib/reglementaire). P8 (EtudeDossier)
// construit les scénarios une fois des DossierPosteTravaux créés à partir
// des opportunités retenues par un humain.
//
// Générique par construction : aucune référence à un typeTravaux précis
// dans ce fichier - tout vient des FicheMetier passées en entrée. Une
// nouvelle prestation = une nouvelle ligne FicheMetier, jamais une
// modification de ce moteur (audit section F : "sans modifier le moteur
// Opportunités").
// ============================================================

function evaluateConditions(
  ficheMetier: FicheMetierInput,
  reponses: OpportunitesInput["reponses"],
  questionsByCode: Record<string, QuestionDef>
): { satisfied: number; total: number; positives: string[]; negatives: string[] } {
  const positives: string[] = [];
  const negatives: string[] = [];
  let satisfied = 0;

  for (const condition of ficheMetier.conditionsActivation) {
    const question = questionsByCode[condition.questionCode];
    if (!question) {
      negatives.push(`Condition référencée sur une question inconnue (${condition.questionCode}) - ignorée.`);
      continue;
    }
    const answer = reponses[condition.questionCode];
    const matches = answerMatchesValue(question, answer, condition.valeurAttendue);
    if (matches) {
      satisfied += 1;
      positives.push(`${condition.questionCode} = ${condition.valeurAttendue}`);
    } else {
      negatives.push(`${condition.questionCode} != ${condition.valeurAttendue} (ou non renseigné)`);
    }
  }

  return { satisfied, total: ficheMetier.conditionsActivation.length, positives, negatives };
}

function computeNiveau(score: number, totalConditions: number): NiveauPertinence {
  if (totalConditions === 0) return "A_ETUDIER";
  if (score >= 70) return "FORTE";
  if (score >= 30) return "A_ETUDIER";
  if (score > 0) return "FAIBLE";
  return "NON_PERTINENT";
}

function computeStatutEligibilite(informationsManquantes: string[], niveau: NiveauPertinence): OpportuniteDetectee["statutEligibilitePotentielle"] {
  if (niveau === "NON_PERTINENT") return "NON_APPLICABLE";
  if (informationsManquantes.length > 0) return "DONNEES_INSUFFISANTES";
  // Jamais ELIGIBLE de façon certaine à ce stade (même philosophie que P7 :
  // une confirmation documentaire/réglementaire reste toujours nécessaire).
  return "A_CONFIRMER";
}

export function detectOpportunites(input: OpportunitesInput): OpportunitesResult {
  const questionsByCode: Record<string, QuestionDef> = Object.fromEntries(
    input.questions.map((q) => [q.code, { code: q.code, type: q.type, conditions: [] }])
  );

  const opportunites: OpportuniteDetectee[] = input.fichesMetier
    .filter((f) => f.actif)
    .map((ficheMetier) => {
      const { satisfied, total, positives, negatives } = evaluateConditions(ficheMetier, input.reponses, questionsByCode);
      const score = total === 0 ? 50 : Math.round((satisfied / total) * 100);
      const niveau = computeNiveau(score, total);

      const informationsManquantes = ficheMetier.donneesNecessairesEligibilite.filter((champ) => !input.champsConnus.has(champ));

      const raisonsPositives = total === 0 ? ["Aucune condition de pertinence configurée pour ce métier - à étudier manuellement."] : positives;

      return {
        typeTravaux: ficheMetier.typeTravaux,
        ficheMetierId: ficheMetier.id,
        ficheMetierCode: ficheMetier.code,
        libelle: ficheMetier.libelle,
        score,
        niveau,
        raisonsPositives,
        raisonsNegatives: negatives,
        informationsManquantes,
        statutEligibilitePotentielle: computeStatutEligibilite(informationsManquantes, niveau),
        programmesATester: ficheMetier.programmes,
        reglesReglementairesATester: ficheMetier.reglesReglementaires,
        prochaineAction: ficheMetier.prochaineAction,
        typeRdvRecommande: ficheMetier.typeRdvRecommande,
      } satisfies OpportuniteDetectee;
    })
    .sort((a, b) => b.score - a.score || a.ficheMetierCode.localeCompare(b.ficheMetierCode));

  return { opportunites, generatedAt: new Date() };
}

/** Métiers à considérer "actifs" pour la phase C (approfondissement) - FORTE ou A_ETUDIER uniquement, jamais FAIBLE/NON_PERTINENT. */
export function selectMetiersActifs(result: OpportunitesResult): string[] {
  return result.opportunites.filter((o) => o.niveau === "FORTE" || o.niveau === "A_ETUDIER").map((o) => o.typeTravaux);
}
