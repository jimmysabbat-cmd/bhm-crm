import { prisma } from "@/lib/prisma";
import { runAutomationRule, toRuleData } from "./engine";
import type { SchedulerRunSummary } from "./types";

// ============================================================
// Planificateur (P11, section 16) - ne dépend pas d'un cron cloud externe :
// runScheduledAutomations() est appelée depuis un script CLI
// (npm run automations:run) ou une route interne protégée
// (/api/internal/automations/run). Détecte tâches échues/callbacks
// leads/RDV proches/paiements en retard/documents expirés/workflow en
// retard EN REJOUANT simplement chaque AutomationRule active - jamais une
// seconde logique de détection parallèle à triggers.ts.
// ============================================================

export async function runScheduledAutomations(now: Date = new Date(), dryRun = false): Promise<SchedulerRunSummary> {
  // MANUAL est explicitement exclu : ces règles ne se déclenchent jamais
  // seules (section 5).
  const rules = await prisma.automationRule.findMany({ where: { actif: true, mode: { in: ["AUTO", "PREPARE_ONLY"] } }, orderBy: { createdAt: "asc" } });

  const summary: SchedulerRunSummary = { startedAt: now, dryRun, rules: [] };
  for (const row of rules) {
    const ruleSummary = await runAutomationRule(toRuleData(row), { now, dryRun });
    summary.rules.push(ruleSummary);
  }
  return summary;
}
