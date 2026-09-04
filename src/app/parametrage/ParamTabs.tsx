"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Programmes",
    items: [{ href: "/parametrage/programmes", label: "Programmes" }],
  },
  {
    label: "Dossiers",
    items: [
      { href: "/parametrage/statuts", label: "Statuts de dossier" },
      { href: "/parametrage/types-dossier", label: "Types de dossier" },
      { href: "/parametrage/modes-paiement", label: "Modes de paiement" },
    ],
  },
  {
    label: "ANAH",
    items: [
      { href: "/parametrage/mar", label: "MAR" },
      { href: "/parametrage/statuts-anah", label: "Statuts ANAH" },
    ],
  },
  {
    label: "Chantier & CEE",
    items: [
      { href: "/parametrage/regie", label: "Régie" },
      { href: "/parametrage/sous-traitants", label: "Sous-traitants" },
      { href: "/parametrage/delegataires-cee", label: "Délégataires CEE" },
      { href: "/parametrage/statuts-cee", label: "Statuts CEE" },
      { href: "/parametrage/statuts-travaux", label: "Statuts travaux" },
    ],
  },
  {
    label: "Réglementaire",
    items: [
      { href: "/parametrage/reglementaire", label: "Règles & versions" },
      { href: "/parametrage/tarifs-cee", label: "Tarifs CEE" },
    ],
  },
  {
    label: "Commercial / Leads",
    items: [
      { href: "/parametrage/leads-sources", label: "Sources leads" },
      { href: "/parametrage/leads-statuts", label: "Statuts pipeline" },
      { href: "/parametrage/leads-resultats", label: "Résultats d'appel" },
    ],
  },
  {
    label: "Automatisations",
    items: [{ href: "/parametrage/automations", label: "Règles & templates" }],
  },
  {
    label: "Accès",
    items: [{ href: "/parametrage/equipe", label: "Équipe" }],
  },
];

export function ParamTabs() {
  const pathname = usePathname();

  return (
    <nav className="w-52 shrink-0 space-y-5">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
