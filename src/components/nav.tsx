import fs from "fs";
import path from "path";
import { LogOut, Zap } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { SidebarNav, type SidebarLink } from "./sidebar-nav";

// Dès qu'un fichier public/logo-bhm.(png|svg|jpg) est ajouté, il remplace
// automatiquement l'icône par défaut — aucune autre modification requise.
function findLogo(): { src: string; isSvg: boolean } | null {
  for (const ext of ["svg", "png", "jpg", "jpeg", "webp"]) {
    const file = `logo-bhm.${ext}`;
    if (fs.existsSync(path.join(process.cwd(), "public", file))) {
      return { src: `/${file}`, isSvg: ext === "svg" };
    }
  }
  return null;
}

const links: SidebarLink[] = [
  { href: "/", label: "Trésorerie", icon: "tresorerie" },
  { href: "/dossiers", label: "Dossiers", icon: "dossiers" },
  { href: "/taches", label: "Tâches & relances", icon: "taches" },
];

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "ADMIN";
  // Section 21 du prompt P6 : /finances accessible à ADMIN/direction et aux
  // rôles comptabilité (nom historique COMPTA conservé pour compatibilité).
  const peutVoirFinances = isAdmin || role === "COMPTABILITE" || role === "COMPTA";
  // P9 : VIEW_LEADS (ADMIN/COMMERCIAL/TELEPROSPECTEUR/ADMINISTRATIF) - liste
  // dupliquée volontairement ici plutôt qu'un import de authz.ts (Nav est un
  // Server Component très en amont, garder le calcul du menu simple et
  // local comme peutVoirFinances ci-dessus).
  const peutVoirLeads = ["ADMIN", "COMMERCIAL", "TELEPROSPECTEUR", "ADMINISTRATIF"].includes(role ?? "");
  const allLinks = [
    ...links,
    ...(peutVoirLeads ? [{ href: "/leads", label: "Leads", icon: "leads" as const }] : []),
    ...(peutVoirFinances ? [{ href: "/finances", label: "Finances", icon: "finances" as const }] : []),
    ...(isAdmin ? [{ href: "/parametrage", label: "Paramétrage", icon: "parametrage" as const }] : []),
  ];

  const initial = session.user.name?.[0]?.toUpperCase() ?? "?";
  const logo = findLogo();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-slate-900">
      <div className="flex items-center gap-2.5 px-5 py-6">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- format inconnu à l'avance (svg/png/jpg)
          <img src={logo.src} alt="BHM" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
            <Zap className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </div>
        )}
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
