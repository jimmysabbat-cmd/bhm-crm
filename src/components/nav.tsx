import fs from "fs";
import path from "path";
import Link from "next/link";
import { LogOut, Zap, ShieldCheck } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { getUnreadNotificationCount } from "@/lib/notifications/service";
import { getActiveTenantIdCookie } from "@/lib/platform/tenant-context";
import { prisma } from "@/lib/prisma";
import { leaveTenantAction } from "@/app/platform/actions";
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

function NavShell({
  links,
  userName,
  userEmail,
  tenantBanner,
}: {
  links: SidebarLink[];
  userName: string;
  userEmail: string;
  tenantBanner?: { tenantName: string } | null;
}) {
  const initial = userName[0]?.toUpperCase() ?? "?";
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

      {/* P12 (section 46) - contexte tenant actif TOUJOURS visible pour un
          PLATFORM SUPER ADMIN, pour éviter toute saisie dans la mauvaise
          société sans s'en rendre compte. */}
      {tenantBanner && (
        <div className="mx-3 mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> Platform Super Admin
          </p>
          <p className="mt-0.5 text-sm font-medium text-white">{tenantBanner.tenantName}</p>
          <form action={leaveTenantAction}>
            <button type="submit" className="mt-1 text-xs font-medium text-emerald-300 hover:text-emerald-200">
              ← Retour plateforme
            </button>
          </form>
        </div>
      )}

      <SidebarNav links={links} />

      <div className="mt-auto border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{userName}</p>
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
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

function PlatformOnlyNav({ userName, userEmail }: { userName: string; userEmail: string }) {
  const initial = userName[0]?.toUpperCase() ?? "?";
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-slate-900">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
          <ShieldCheck className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Plateforme</p>
          <p className="text-[11px] text-slate-500">Platform Super Admin</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        <Link href="/platform" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">
          Accueil
        </Link>
        <Link href="/platform/organisations" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">
          Organisations
        </Link>
      </nav>
      <div className="mt-auto border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">{initial}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{userName}</p>
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" title="Déconnexion" className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;

  const userId = (session.user as { id?: string }).id;
  const role = (session.user as { role?: string }).role;
  const isPlatformSuperAdmin = Boolean((session.user as { isPlatformSuperAdmin?: boolean }).isPlatformSuperAdmin);
  const userName = session.user.name ?? "?";
  const userEmail = session.user.email ?? "";
  const isAdmin = role === "ADMIN";
  const isAdministratif = role === "ADMINISTRATIF";

  // P12 (section 18/46) - un PLATFORM SUPER ADMIN sans tenant entré n'a
  // JAMAIS de menu tenant implicite : il voit uniquement la plateforme.
  if (isPlatformSuperAdmin) {
    const activeTenantId = await getActiveTenantIdCookie();
    if (!activeTenantId) return <PlatformOnlyNav userName={userName} userEmail={userEmail} />;
    const tenant = await prisma.organisation.findUnique({ where: { id: activeTenantId }, select: { nom: true } });
    if (!tenant) return <PlatformOnlyNav userName={userName} userEmail={userEmail} />;
    // Sinon : continue ci-dessous avec le menu tenant normal + bannière.
    const unreadCount = userId ? await getUnreadNotificationCount(userId) : 0;
    const allLinksAdmin: SidebarLink[] = [
      ...links,
      { href: "/leads", label: "Leads", icon: "leads" },
      { href: "/documents/a-verifier", label: "Documents", icon: "documents" },
      { href: "/finances", label: "Finances", icon: "finances" },
      { href: "/automations", label: "Automatisations", icon: "automations" },
      { href: "/notifications", label: "Notifications", icon: "notifications", badge: unreadCount },
      { href: "/parametrage", label: "Paramétrage", icon: "parametrage" },
    ];
    return <NavShell links={allLinksAdmin} userName={userName} userEmail={userEmail} tenantBanner={{ tenantName: tenant.nom }} />;
  }

  // P11 (section 23/24) - un compte partenaire n'a JAMAIS accès aux liens
  // internes (dossiers/finances/leads/paramétrage...), même masqués : un
  // menu dédié et volontairement minimal.
  if (role === "SOUS_TRAITANT" || role === "DELEGATAIRE_CEE") {
    return <NavShell links={[{ href: "/partenaire", label: "Espace partenaire", icon: "partenaire" }]} userName={userName} userEmail={userEmail} />;
  }

  // Section 21 du prompt P6 : /finances accessible à ADMIN/direction et aux
  // rôles comptabilité (nom historique COMPTA conservé pour compatibilité).
  const peutVoirFinances = isAdmin || role === "COMPTABILITE" || role === "COMPTA";
  // P9 : VIEW_LEADS (ADMIN/COMMERCIAL/TELEPROSPECTEUR/ADMINISTRATIF) - liste
  // dupliquée volontairement ici plutôt qu'un import de authz.ts (Nav est un
  // Server Component très en amont, garder le calcul du menu simple et
  // local comme peutVoirFinances ci-dessus).
  const peutVoirLeads = ["ADMIN", "COMMERCIAL", "TELEPROSPECTEUR", "ADMINISTRATIF"].includes(role ?? "");
  // P10 : VIEW_DOCUMENTS (ADMIN/ADMINISTRATIF/COMMERCIAL/TECHNIQUE/COMPTA/COMPTABILITE).
  const peutVoirDocuments = ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "TECHNIQUE", "COMPTA", "COMPTABILITE"].includes(role ?? "");
  // P11 : VIEW_AUTOMATIONS (ADMIN/ADMINISTRATIF), VIEW_NOTIFICATIONS (tout
  // rôle interne).
  const peutVoirAutomations = isAdmin || isAdministratif;
  const peutVoirNotifications = role != null && role !== "SOUS_TRAITANT" && role !== "DELEGATAIRE_CEE";

  const unreadCount = userId && peutVoirNotifications ? await getUnreadNotificationCount(userId) : 0;

  const allLinks: SidebarLink[] = [
    ...links,
    ...(peutVoirLeads ? [{ href: "/leads", label: "Leads", icon: "leads" as const }] : []),
    ...(peutVoirDocuments ? [{ href: "/documents/a-verifier", label: "Documents", icon: "documents" as const }] : []),
    ...(peutVoirFinances ? [{ href: "/finances", label: "Finances", icon: "finances" as const }] : []),
    ...(peutVoirAutomations ? [{ href: "/automations", label: "Automatisations", icon: "automations" as const }] : []),
    ...(peutVoirNotifications ? [{ href: "/notifications", label: "Notifications", icon: "notifications" as const, badge: unreadCount }] : []),
    ...(isAdmin ? [{ href: "/parametrage", label: "Paramétrage", icon: "parametrage" as const }] : []),
  ];

  return <NavShell links={allLinks} userName={userName} userEmail={userEmail} />;
}
