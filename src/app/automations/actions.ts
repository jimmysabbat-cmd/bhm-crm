"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { previewAutomationRule, runAutomationRuleById } from "@/lib/automations/engine";
import type { RuleRunSummary } from "@/lib/automations/types";

// ============================================================
// Server Actions du tableau de bord automatisations (P11, sections 19/32).
// ============================================================

export async function previewRuleAction(ruleId: string): Promise<{ ok: true; summary: RuleRunSummary } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VIEW_AUTOMATIONS")) throw new Error("Accès refusé.");
    const summary = await previewAutomationRule(ruleId, ctx.organisationId);
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function runRuleNowAction(ruleId: string): Promise<{ ok: true; summary: RuleRunSummary } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_AUTOMATIONS")) throw new Error("Accès refusé.");
    const summary = await runAutomationRuleById(ruleId, ctx.organisationId, { manual: true });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "AutomationRule", entityId: ruleId, action: "AUTOMATION_EXECUTEE_MANUELLEMENT", metadata: { executed: summary.executed, skipped: summary.skipped, errors: summary.errors } });
    revalidatePath("/automations");
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function toggleRuleActiveAction(ruleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_AUTOMATIONS")) throw new Error("Accès refusé.");
    const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, organisationId: ctx.organisationId } });
    if (!rule) throw new Error("Règle introuvable.");
    await prisma.automationRule.update({ where: { id: rule.id }, data: { actif: !rule.actif } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "AutomationRule", entityId: rule.id, action: rule.actif ? "AUTOMATION_DESACTIVEE" : "AUTOMATION_ACTIVEE" });
    revalidatePath("/automations");
    revalidatePath("/parametrage/automations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
