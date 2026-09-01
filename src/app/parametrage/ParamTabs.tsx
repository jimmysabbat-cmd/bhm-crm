"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/parametrage/statuts", label: "Statuts de dossier" },
  { href: "/parametrage/types-dossier", label: "Types de dossier" },
  { href: "/parametrage/modes-paiement", label: "Modes de paiement" },
  { href: "/parametrage/mar", label: "MAR" },
  { href: "/parametrage/statuts-anah", label: "Statuts ANAH" },
  { href: "/parametrage/regie", label: "Régie" },
  { href: "/parametrage/sous-traitants", label: "Sous-traitants" },
  { href: "/parametrage/delegataires-cee", label: "Délégataires CEE" },
  { href: "/parametrage/equipe", label: "Équipe" },
];

export function ParamTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 pb-3 text-sm font-medium transition ${
              active
                ? "border-emerald-500 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
