import { LogOut, Zap } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { SidebarNav, type SidebarLink } from "./sidebar-nav";

const links: SidebarLink[] = [
  { href: "/", label: "Trésorerie", icon: "tresorerie" },
  { href: "/dossiers", label: "Dossiers", icon: "dossiers" },
  { href: "/taches", label: "Tâches & relances", icon: "taches" },
];

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;

  const isAdmin = (session.user as { role?: string }).role === "ADMIN";
  const allLinks = isAdmin
    ? [...links, { href: "/parametrage", label: "Paramétrage", icon: "parametrage" as const }]
    : links;

  const initial = session.user.name?.[0]?.toUpperCase() ?? "?";

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-slate-900">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
          <Zap className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">BHM CRM</p>
          <p className="text-[11px] text-slate-500">Le Bonheur d&apos;Habiter Mieux</p>
        </div>
      </div>

      <SidebarNav links={allLinks} />

      <div className="mt-auto border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{session.user.name}</p>
            <p className="truncate text-xs text-slate-500">{session.user.email}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              title="Déconnexion"
              className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
