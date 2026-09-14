import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, CalendarClock, CalendarCheck, Wrench, CheckCircle2, Plus } from "lucide-react";
import { requireUserContext } from "@/lib/authz";
import { getDashboardCountsForDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { Card } from "@/components/ui/Card";

export default async function PortailDoDashboardPage() {
  const ctx = await requireUserContext();
  if (ctx.role !== "DONNEUR_ORDRE") redirect("/");

  const counts = await getDashboardCountsForDonneurOrdre(ctx);

  const tiles = [
    { href: "/portail-do/mes-demandes", label: "Mes demandes", value: counts.total, icon: ClipboardList },
    { href: "/portail-do/a-programmer", label: "À programmer", value: counts.aProgrammer, icon: CalendarClock },
    { href: "/portail-do/programmes", label: "Programmés", value: counts.programmes, icon: CalendarCheck },
    { href: "/portail-do/en-cours", label: "En cours", value: counts.enCours, icon: Wrench },
    { href: "/portail-do/termines", label: "Terminés", value: counts.termines, icon: CheckCircle2 },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tableau de bord</h1>
          <p className="mt-1 text-sm text-slate-500">Vue d&apos;ensemble de vos chantiers envoyés.</p>
        </div>
        <Link href="/portail-do/nouvelle-demande" className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" />
          Envoyer un chantier
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="flex flex-col items-center gap-2 p-5 text-center hover:border-emerald-300">
              <t.icon className="h-6 w-6 text-emerald-600" />
              <div className="text-2xl font-semibold text-slate-900">{t.value}</div>
              <div className="text-xs text-slate-500">{t.label}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
