import type { UserContext } from "@/lib/authz";
import { hasPermission } from "@/lib/authz";
import type { StudyScenario, StudyResult } from "./types";

// ============================================================
// Filtrage par rôle du résultat d'une étude (P8, section 31) : "le même
// scénario doit s'afficher différemment selon le rôle". Un COMMERCIAL peut
// simuler/consulter ses dossiers mais ne doit JAMAIS voir les coûts internes
// ni la marge sans VIEW_MARGIN/VIEW_INTERNAL_COSTS - même via une action qui
// renvoie directement les données au client (pas seulement dans l'UI).
// Le CA contractuel et le reste à charge client restent visibles (ce n'est
// pas un coût interne, c'est ce que le commercial négocie avec le client).
// ============================================================

export type RedactedStudyScenario = Omit<StudyScenario, "margin" | "coutsPrevusCts"> & {
  margin: StudyScenario["margin"] | null;
  coutsPrevusCts: number | null;
};

export type RedactedStudyResult = Omit<StudyResult, "scenarios"> & { scenarios: RedactedStudyScenario[] };

export function canViewStudyCostsAndMargin(ctx: UserContext): boolean {
  return hasPermission(ctx, "VIEW_MARGIN") || hasPermission(ctx, "VIEW_INTERNAL_COSTS");
}

// Les tableaux texte libres (score.reasons, recommandationReasons, risques)
// peuvent mentionner la marge en clair ("Marge prévisionnelle 40 %") - on ne
// peut pas se contenter de masquer le champ structuré `margin` sans aussi
// neutraliser ces mentions, sinon l'information réapparaît par un autre
// chemin pour un rôle qui ne doit pas la voir.
function redactMarginMentions(lines: string[]): string[] {
  return lines.map((l) => (/marge/i.test(l) ? "Marge : information réservée à ce rôle." : l));
}

function sanitizeScenario(scenario: StudyScenario, canView: boolean): RedactedStudyScenario {
  if (canView) return scenario;
  return {
    ...scenario,
    margin: null,
    coutsPrevusCts: null,
    score: { ...scenario.score, reasons: redactMarginMentions(scenario.score.reasons) },
    recommandationReasons: redactMarginMentions(scenario.recommandationReasons),
    risques: redactMarginMentions(scenario.risques),
  };
}

export function sanitizeScenariosForRole(scenarios: StudyScenario[], ctx: UserContext): RedactedStudyScenario[] {
  const canView = canViewStudyCostsAndMargin(ctx);
  return scenarios.map((s) => sanitizeScenario(s, canView));
}

export function sanitizeStudyResultForRole(result: StudyResult, ctx: UserContext): RedactedStudyResult {
  return { ...result, scenarios: sanitizeScenariosForRole(result.scenarios, ctx) };
}
