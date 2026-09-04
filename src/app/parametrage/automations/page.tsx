import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RuleConfigForm } from "./RuleConfigForm";
import { TemplateEditForm } from "./TemplateEditForm";

// ============================================================
// Paramétrage automatisations (P11, section 33) - activer/désactiver,
// délais, mode, templates. Aucune saisie de code : uniquement des menus/
// champs bornés et des templates à variables whitelistées.
// ============================================================

export default async function ParametrageAutomationsPage() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "MANAGE_AUTOMATIONS")) redirect("/");

  const [rules, templates] = await Promise.all([
    prisma.automationRule.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { createdAt: "asc" } }),
    prisma.emailTemplate.findMany({ where: { OR: [{ organisationId: ctx.organisationId }, { organisationId: null }] }, orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Paramétrage des automatisations</h1>
        <p className="mt-1 text-sm text-slate-500">Règles : mode et délai. Templates : sujet/corps (variables whitelistées uniquement).</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Règles</h2>
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {rules.map((r) => (
            <div key={r.id} className="space-y-2 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{r.nom}</p>
                  <p className="text-xs text-slate-400">
                    {r.code} · {r.triggerType} → {r.actionType}
                  </p>
                </div>
                <Badge color={r.actif ? "emerald" : "slate"}>{r.actif ? "Active" : "Inactive"}</Badge>
              </div>
              <RuleConfigForm ruleId={r.id} mode={r.mode} delayJours={r.delayJours} />
            </div>
          ))}
          {rules.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Aucune règle.</div>}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Templates email</h2>
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {templates.map((t) => (
            <div key={t.id} className="space-y-2 px-5 py-4">
              <p className="text-sm font-medium text-slate-900">
                {t.nom} <span className="text-xs font-normal text-slate-400">({t.code})</span>
              </p>
              <TemplateEditForm templateId={t.id} sujetTemplate={t.sujetTemplate} bodyTemplate={t.bodyTemplate} />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
