import { prisma } from "@/lib/prisma";

// ============================================================
// Dashboard automatisations (P11, section 32) - vue de synthèse : règles
// actives, dernières exécutions, erreurs, drafts en attente, webhooks en
// erreur.
// ============================================================

export type AutomationRuleSummary = {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  mode: string;
  triggerType: string;
  actionType: string;
  lastExecutedAt: Date | null;
  successCount: number;
  errorCount: number;
};

export async function getAutomationDashboard(organisationId: string) {
  const rules = await prisma.automationRule.findMany({
    where: { organisationId },
    orderBy: { createdAt: "asc" },
    include: {
      executions: { orderBy: { executedAt: "desc" }, take: 20, select: { status: true, executedAt: true, error: true, entityType: true, entityId: true } },
    },
  });

  const ruleSummaries: AutomationRuleSummary[] = rules.map((r) => ({
    id: r.id,
    code: r.code,
    nom: r.nom,
    actif: r.actif,
    mode: r.mode,
    triggerType: r.triggerType,
    actionType: r.actionType,
    lastExecutedAt: r.executions[0]?.executedAt ?? null,
    successCount: r.executions.filter((e) => e.status === "SUCCESS").length,
    errorCount: r.executions.filter((e) => e.status === "ERROR").length,
  }));

  const recentErrors = await prisma.automationExecution.findMany({
    where: { organisationId, status: "ERROR" },
    orderBy: { executedAt: "desc" },
    take: 20,
    include: { rule: { select: { code: true, nom: true } } },
  });

  const pendingDrafts = await prisma.emailDraft.count({ where: { organisationId, statut: "BROUILLON" } });
  const webhooksInError = await prisma.webhookDelivery.count({ where: { organisationId, statut: "ECHEC" } });

  return { rules: ruleSummaries, recentErrors, pendingDrafts, webhooksInError };
}
