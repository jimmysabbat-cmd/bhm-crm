import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const tabs = [
  { href: "/parametrage/statuts", label: "Statuts de dossier" },
  { href: "/parametrage/types-dossier", label: "Types de dossier" },
  { href: "/parametrage/modes-paiement", label: "Modes de paiement" },
  { href: "/parametrage/mar", label: "MAR" },
  { href: "/parametrage/statuts-anah", label: "Statuts ANAH" },
  { href: "/parametrage/equipe", label: "Équipe" },
];

export default async function ParametrageLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Paramétrage</h1>
      <nav className="flex gap-4 border-b border-neutral-200">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="px-1 pb-3 text-sm font-medium text-neutral-500 hover:text-neutral-900"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
