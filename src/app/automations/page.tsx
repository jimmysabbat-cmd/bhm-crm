import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { getAutomationDashboard } from "@/lib/automations/dashboard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RuleActions } from "./RuleActions";

// ============================================================
// Dashboard automatisations (P11, section 32).
// ============================================================

const MODE_LABELS: Record<string, string> = { MANUAL: "Manuel", AUTO: "Automatique", PREPARE_ONLY: "Préparation seule" };

export default async function AutomationsPage() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_AUTOMATIONS")) redirect("/");

  const { rules, recentErrors, pendingDrafts, webhooksInError } = await getAutomationDashboard(ctx.organisationId);
  const canManage = hasPermission(ctx, "MANAGE_AUTOMATIONS");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Automatisations</h1>
          <p className="mt-1 text-sm text-slate-500">{rules.filter((r) => r.actif).length} règle(s) active(s) sur {rules.length}.</p>
        </div>
        {canManage && (
          <Link href="/parametrage/automations" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
            Paramétrer →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Drafts email en attente</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{pendingDrafts}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Webhooks en erreur</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{webhooksInError}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Erreurs récentes</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{recentErrors.length}</p>
        </Card>
      </div>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium text-slate-700">Règles</div>
        {rules.map((r) => (
          <div key={r.id} className="space-y-2 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">{r.nom}</p>
                <p className="text-xs text-slate-400">
                  {r.code} · {r.triggerType} → {r.actionType}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={r.actif ? "emerald" : "slate"}>{r.actif ? "Active" : "Inactive"}</Badge>
                <Badge color="blue">{MODE_LABELS[r.mode] ?? r.mode}</Badge>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {r.successCount} succès / {r.errorCount} erreur(s) (20 dernières exécutions){r.lastExecutedAt ? ` · dernière : ${r.lastExecutedAt.toLocaleString("fr-FR")}` : ""}
            </p>
            <RuleActions ruleId={r.id} canManage={canManage} />
          </div>
        ))}
        {rules.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Aucune règle configurée.</div>}
      </Card>

      {recentErrors.length > 0 && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          <div className="px-5 py-3 text-sm font-medium text-slate-700">Erreurs récentes</div>
          {recentErrors.map((e) => (
            <div key={e.id} className="px-5 py-3 text-sm">
              <p className="font-medium text-slate-900">{e.rule.nom}</p>
              <p className="text-xs text-red-600">{e.error}</p>
              <p className="text-xs text-slate-400">{e.executedAt.toLocaleString("fr-FR")}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
