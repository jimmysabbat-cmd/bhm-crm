import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

const links = [
  { href: "/", label: "Trésorerie" },
  { href: "/dossiers", label: "Dossiers" },
  { href: "/taches", label: "Tâches & relances" },
];

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;

  const isAdmin = (session.user as { role?: string }).role === "ADMIN";
  const allLinks = isAdmin ? [...links, { href: "/parametrage", label: "Paramétrage" }] : links;

  return (
    <nav className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold text-neutral-900">BHM CRM</span>
        {allLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-neutral-500">{session.user.name}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
            Déconnexion
          </button>
        </form>
      </div>
    </nav>
  );
}
