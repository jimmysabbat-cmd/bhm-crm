// ============================================================
// Moteur de questionnaire configurable (P9, section 7/8) - fonctions pures,
// aucune dépendance React : les branches conditionnelles (section 7) sont
// évaluées ici, jamais codées en dur dans un composant.
// ============================================================

export type TypeQuestionValue = "TEXT" | "NUMBER" | "YES_NO" | "SINGLE_SELECT" | "MULTI_SELECT" | "DATE";

export type QuestionCondition = {
  questionDeclenchanteCode: string;
  valeurAttendue: string;
};

export type QuestionDef = {
  code: string;
  type: TypeQuestionValue;
  conditions: QuestionCondition[];
};

export type AnswerValue = {
  texte?: string | null;
  nombre?: number | null;
  bool?: boolean | null;
  date?: string | null;
  options?: string[] | null;
};

/** Une question sans condition est toujours visible. Avec conditions, TOUTES doivent être satisfaites (ET). */
export function answerMatchesValue(question: QuestionDef, answer: AnswerValue | undefined, expected: string): boolean {
  if (!answer) return false;
  switch (question.type) {
    case "YES_NO": {
      if (answer.bool == null) return false;
      return (answer.bool ? "true" : "false") === expected;
    }
    case "SINGLE_SELECT":
      return answer.options?.[0] === expected;
    case "MULTI_SELECT":
      return !!answer.options?.includes(expected);
    default:
      return answer.texte === expected;
  }
}

export function isQuestionVisible(question: QuestionDef, reponses: Record<string, AnswerValue>, questionsByCode: Record<string, QuestionDef>): boolean {
  if (question.conditions.length === 0) return true;
  return question.conditions.every((c) => {
    const trigger = questionsByCode[c.questionDeclenchanteCode];
    if (!trigger) return false;
    return answerMatchesValue(trigger, reponses[c.questionDeclenchanteCode], c.valeurAttendue);
  });
}

/** Filtre la liste complète de questions à celles réellement visibles compte tenu des réponses déjà données. */
export function evaluateVisibleQuestions<T extends QuestionDef>(questions: T[], reponses: Record<string, AnswerValue>): T[] {
  const byCode: Record<string, QuestionDef> = Object.fromEntries(questions.map((q) => [q.code, q]));
  return questions.filter((q) => isQuestionVisible(q, reponses, byCode));
}
