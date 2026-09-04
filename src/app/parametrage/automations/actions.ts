"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { validateTemplateVariables } from "@/lib/automations/templates";
import type { AutomationRuleMode } from "@/generated/prisma/enums";

// ============================================================
// Paramétrage automatisations (P11, section 33) - activer/désactiver,
// délais, mode ; templates avec variables whitelistées uniquement (jamais
// de code injectable - validateTemplateVariables rejette toute variable
// inconnue avant sauvegarde).
// ============================================================

export async function updateRuleConfigAction(ruleId: string, mode: AutomationRuleMode, delayJours: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_AUTOMATIONS")) throw new Error("Accès refusé.");
    const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, organisationId: ctx.organisationId } });
    if (!rule) throw new Error("Règle introuvable.");

    await prisma.automationRule.update({ where: { id: rule.id }, data: { mode, delayJours: Number.isFinite(delayJours) ? delayJours : rule.delayJours } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "AutomationRule", entityId: rule.id, action: "AUTOMATION_CONFIGUREE", metadata: { mode, delayJours } });

    revalidatePath("/parametrage/automations");
    revalidatePath("/automations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function updateEmailTemplateAction(templateId: string, sujetTemplate: string, bodyTemplate: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_AUTOMATIONS")) throw new Error("Accès refusé.");

    const sujetCheck = validateTemplateVariables(sujetTemplate);
    const bodyCheck = validateTemplateVariables(bodyTemplate);
    if (!sujetCheck.valid || !bodyCheck.valid) {
      throw new Error(`Variable(s) inconnue(s) : ${[...sujetCheck.unknownVariables, ...bodyCheck.unknownVariables].join(", ")}`);
    }

    const template = await prisma.emailTemplate.findFirst({ where: { id: templateId, OR: [{ organisationId: ctx.organisationId }, { organisationId: null }] } });
    if (!template) throw new Error("Template introuvable.");

    await prisma.emailTemplate.update({ where: { id: template.id }, data: { sujetTemplate, bodyTemplate } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "EmailTemplate", entityId: template.id, action: "TEMPLATE_MODIFIE" });

    revalidatePath("/parametrage/automations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
