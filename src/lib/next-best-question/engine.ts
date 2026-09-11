import { evaluateVisibleQuestions, type QuestionCondition, type AnswerValue, type TypeQuestionValue } from "@/lib/questionnaire/engine";
import type { CategorieImpactQuestion } from "@/generated/prisma/enums";

// ============================================================
// Next Best Question (P14) - fonction pure et déterministe. Détermine LA
// prochaine question la plus utile à poser, sans jamais coder de règle
// dans l'UI (audit section E) :
//
//   1. récupère les questions potentiellement applicables (tronc commun +
//      métiers actuellement actifs)
//   2. applique les ConditionQuestion existantes (réutilise EXACTEMENT le
//      même évaluateur que le questionnaire, jamais une seconde logique)
//   3. exclut les champs déjà correctement renseignés - DÉDUPLICATION PAR
//      champMappe, jamais par metierConcerne (audit) : si PAC et ITE
//      nécessitent tous deux "Logement.isolationMurs", la question n'est
//      posée qu'une fois.
//   4. trie par categorieImpact (l'ORDRE DE DÉCLARATION de l'enum EST
//      l'ordre de priorité) puis, seulement à égalité de catégorie,
//      départage par poidsCommercial - un poids commercial ne peut donc
//      JAMAIS faire passer une question devant une catégorie supérieure.
//   5. retourne UNE question + les raisons de son choix.
//
// poidsCommercial n'est JAMAIS transmis à un moteur P7/P8 : ce fichier ne
// calcule aucune éligibilité, aucun montant, aucun CEE - il ne fait que
// choisir QUELLE question poser.
// ============================================================

// Ordre de priorité fixe (audit section 6) - BLOQUANT_DECISION en premier.
// Une question sans categorieImpact (undefined/null) est traitée à la
// priorité la plus basse, jamais comme bloquante par défaut.
const PRIORITE_ORDRE: CategorieImpactQuestion[] = [
  "BLOQUANT_DECISION",
  "ELIGIBILITE",
  "CONFIRMATION_OPPORTUNITE",
  "PROGRAMME_AIDE",
  "SCENARIO",
  "TECHNIQUE_RDV",
  "COMMERCIAL",
];

export type NbqQuestion = {
  // Identifiant technique réel (nécessaire pour écrire une réponse via
  // ReponseQuestion.questionId) - code reste la clé stable utilisée par les
  // conditions/mapping, jamais l'inverse.
  id: string;
  code: string;
  type: TypeQuestionValue;
  conditions: QuestionCondition[];
  champMappe: string | null;
  metierConcerne: string | null;
  categorieImpact: CategorieImpactQuestion | null;
  poidsCommercial: number;
  obligatoire: boolean;
  libelle: string;
};

export type NbqContext = {
  // Toutes les questions du/des questionnaire(s) actif(s) du tenant
  // (tronc commun ET branches métier) - le filtrage par métier actif se
  // fait DANS ce moteur, jamais en amont, pour que les ConditionQuestion
  // référençant une question de tronc commun restent résolvables.
  questions: NbqQuestion[];
  // Réponses déjà données, indexées par code de question.
  reponses: Record<string, AnswerValue>;
  // Noms de champs réels (convention "Logement.xxx"/"Client.xxx") déjà
  // connus avec une confiance suffisante - construit par l'appelant à
  // partir de Logement/Client/ChampProvenance, jamais recalculé ici.
  champsConnus: Set<string>;
  // Métiers actuellement retenus comme opportunité plausible (Phase C -
  // approfondissement). Vide/absent = Phase A (tronc commun uniquement).
  metiersActifs?: string[];
};

export type NbqResult = {
  question: NbqQuestion | null;
  reasons: string[];
};

export function selectNextBestQuestion(ctx: NbqContext): NbqResult {
  const metiersActifs = ctx.metiersActifs ?? [];

  // 1. Potentiellement applicables : tronc commun (metierConcerne null) ou
  // métier actuellement actif.
  const applicables = ctx.questions.filter((q) => q.metierConcerne == null || metiersActifs.includes(q.metierConcerne));

  // 2. ConditionQuestion - réutilise le moteur questionnaire existant tel
  // quel. "applicables" inclut déjà tout le tronc commun (metierConcerne
  // null, toujours présent quel que soit metiersActifs) + les métiers
  // actifs, donc toute condition bien formée (référençant une question du
  // tronc commun ou du même métier) reste résolvable.
  const visibles = evaluateVisibleQuestions(applicables, ctx.reponses);

  // 3. Exclusion : déjà répondu (par code) OU champ réel déjà connu (par
  // champMappe) - la déduplication cross-métier passe UNIQUEMENT par
  // champMappe, jamais par metierConcerne.
  const restantes = visibles.filter((q) => {
    if (q.code in ctx.reponses) return false;
    if (q.champMappe && ctx.champsConnus.has(q.champMappe)) return false;
    return true;
  });

  if (restantes.length === 0) {
    return { question: null, reasons: ["Aucune question restante applicable compte tenu des réponses et données déjà connues."] };
  }

  // 4. Tri : priorité de categorieImpact d'abord, poidsCommercial ensuite
  // (départage UNIQUEMENT dans la même catégorie), code en dernier recours
  // pour un ordre stable/déterministe.
  const trie = [...restantes].sort((a, b) => {
    const ia = a.categorieImpact ? PRIORITE_ORDRE.indexOf(a.categorieImpact) : PRIORITE_ORDRE.length;
    const ib = b.categorieImpact ? PRIORITE_ORDRE.indexOf(b.categorieImpact) : PRIORITE_ORDRE.length;
    if (ia !== ib) return ia - ib;
    if (a.poidsCommercial !== b.poidsCommercial) return b.poidsCommercial - a.poidsCommercial;
    return a.code.localeCompare(b.code);
  });

  const best = trie[0];
  const prioriteIndex = best.categorieImpact ? PRIORITE_ORDRE.indexOf(best.categorieImpact) : PRIORITE_ORDRE.length - 1;
  const reasons = [
    `Catégorie ${best.categorieImpact ?? "COMMERCIAL (par défaut)"} - priorité ${prioriteIndex + 1}/${PRIORITE_ORDRE.length}.`,
    best.obligatoire ? "Question obligatoire." : "Question optionnelle.",
  ];
  if (best.metierConcerne) reasons.push(`Nécessaire pour approfondir l'opportunité ${best.metierConcerne}.`);
  if (best.champMappe) reasons.push(`Alimente ${best.champMappe}.`);

  return { question: best, reasons };
}
