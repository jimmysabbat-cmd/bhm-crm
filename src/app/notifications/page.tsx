import { redirect } from "next/navigation";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { getNotificationsForUser } from "@/lib/notifications/service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { markRead, markAllRead } from "./actions";

// ============================================================
// Centre de notifications (P11, section 14/15) - rafraîchissement page
// standard, pas de websocket.
// ============================================================

export default async function NotificationsPage() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_NOTIFICATIONS")) redirect("/");

  const notifications = await getNotificationsForUser(ctx.userId);
  const nbNonLues = notifications.filter((n) => n.readAt == null).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">{nbNonLues} non lue(s) sur {notifications.length}.</p>
        </div>
        {nbNonLues > 0 && (
          <form action={markAllRead}>
            <button type="submit" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Tout marquer comme lu
            </button>
          </form>
        )}
      </div>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-start justify-between gap-4 px-5 py-4 ${n.readAt == null ? "bg-emerald-50/40" : ""}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                {n.readAt == null && <Badge color="emerald">Non lu</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>
              <p className="mt-1 text-xs text-slate-400">{n.createdAt.toLocaleString("fr-FR")}</p>
            </div>
            {n.readAt == null && (
              <form action={markRead.bind(null, n.id)}>
                <button type="submit" className="shrink-0 text-xs font-medium text-slate-400 hover:text-emerald-700">
                  Marquer lu
                </button>
              </form>
            )}
          </div>
        ))}
        {notifications.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Aucune notification.</div>}
      </Card>
    </div>
  );
}
