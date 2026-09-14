import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { getPlanningEvents, getPlanningFilterOptions } from "@/lib/planning-access";
import { parseVue, parseDate, getRange, addDays, isoDate, sameDay, shiftDate, type PlanningVue } from "@/lib/planning";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// ============================================================
// P16 - Planning central (RDV téléphoniques/commerciaux + missions
// ST/régie), une seule architecture, trois vues (jour/semaine/mois par
// défaut). Lecture seule ici - le pilotage des statuts de mission se fait
// depuis la page dossier (MissionsPanel), jamais dupliqué ici.
// ============================================================

const STATUT_LABELS: Record<string, string> = {
  PLANIFIE: "Planifié",
  CONFIRME: "Confirmé",
  REALISE: "Réalisé",
  ANNULE: "Annulé",
  ENVOYEE: "Envoyée",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  PLANIFIEE: "Planifiée",
  EN_COURS: "En cours",
  TERMINEE: "Terminée",
};
const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  PLANIFIE: "blue",
  CONFIRME: "emerald",
  REALISE: "emerald",
  ANNULE: "slate",
  ENVOYEE: "blue",
  ACCEPTEE: "emerald",
  REFUSEE: "red",
  PLANIFIEE: "blue",
  EN_COURS: "amber",
  TERMINEE: "emerald",
};

function buildHref(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
  const qs = usp.toString();
  return `/planning${qs ? `?${qs}` : ""}`;
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; date?: string; commercialId?: string; sousTraitantId?: string; regieId?: string; metier?: string; statut?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireUserContext();
  if (isPartnerRole(ctx)) redirect("/partenaire");

  const vue = parseVue(sp.vue);
  const date = parseDate(sp.date);
  const range = getRange(vue, date);
  const filters = { commercialId: sp.commercialId, sousTraitantId: sp.sousTraitantId, regieId: sp.regieId, metier: sp.metier, statut: sp.statut };

  const [events, options] = await Promise.all([getPlanningEvents(ctx, range, filters), getPlanningFilterOptions(ctx)]);

  const today = new Date();
  const prevHref = buildHref({ ...sp, date: isoDate(shiftDate(vue, date, -1)) });
  const nextHref = buildHref({ ...sp, date: isoDate(shiftDate(vue, date, 1)) });
  const todayHref = buildHref({ ...sp, date: undefined });

  const rangeLabel =
    vue === "jour"
      ? date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : vue === "mois"
        ? date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
        : `Semaine du ${range.start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${addDays(range.end, -1).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <CalendarDays className="h-6 w-6 text-emerald-600" />
            Planning
          </h1>
          <p className="mt-1 text-sm capitalize text-slate-500">{rangeLabel}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            {(["jour", "semaine", "mois"] as PlanningVue[]).map((v) => (
              <Link
                key={v}
                href={buildHref({ ...sp, vue: v })}
                className={`px-3 py-1.5 text-sm capitalize ${v === vue ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {v}
              </Link>
            ))}
          </div>
          <Link href={prevHref} className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={todayHref} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Aujourd&apos;hui
          </Link>
          <Link href={nextHref} className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="vue" value={vue} />
          <input type="hidden" name="date" value={isoDate(date)} />
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Commercial / télépro</label>
            <select name="commercialId" defaultValue={sp.commercialId ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Tous</option>
              {options.commerciaux.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Sous-traitant</label>
            <select name="sousTraitantId" defaultValue={sp.sousTraitantId ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Tous</option>
              {options.sousTraitants.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Équipe interne</label>
            <select name="regieId" defaultValue={sp.regieId ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Toutes</option>
              {options.regies.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Métier / prestation</label>
            <select name="metier" defaultValue={sp.metier ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Tous</option>
              {Object.entries(typeTravauxLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Statut</label>
            <select name="statut" defaultValue={sp.statut ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Tous</option>
              {Object.entries(STATUT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            Filtrer
          </button>
          {(sp.commercialId || sp.sousTraitantId || sp.regieId || sp.metier || sp.statut) && (
            <Link href={buildHref({ vue: sp.vue, date: sp.date })} className="text-sm text-slate-500 hover:underline">
              Réinitialiser
            </Link>
          )}
        </form>
      </Card>

      {vue === "mois" ? (
        <MonthGrid range={range} events={events} today={today} />
      ) : (
        <DayColumns vue={vue} range={range} events={events} today={today} />
      )}
    </div>
  );
}

function EventCard({ event }: { event: Awaited<ReturnType<typeof getPlanningEvents>>[number] }) {
  const content = (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-xs shadow-sm hover:border-emerald-300">
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium text-slate-900">
          {event.date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} {event.titre}
        </span>
        <Badge color={STATUT_COLORS[event.statut] ?? "slate"}>{STATUT_LABELS[event.statut] ?? event.statut}</Badge>
      </div>
      {event.sousTitre && <div className="mt-0.5 truncate text-slate-500">{event.sousTitre}</div>}
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{event.kind === "RDV" ? "RDV" : "Mission"}</div>
    </div>
  );
  return event.href ? (
    <Link href={event.href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

function DayColumns({
  vue,
  range,
  events,
  today,
}: {
  vue: PlanningVue;
  range: { start: Date; end: Date };
  events: Awaited<ReturnType<typeof getPlanningEvents>>;
  today: Date;
}) {
  const days: Date[] = [];
  for (let d = new Date(range.start); d < range.end; d = addDays(d, 1)) days.push(new Date(d));

  return (
    <div className={`grid gap-3 ${vue === "jour" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-7"}`}>
      {days.map((day) => {
        const dayEvents = events.filter((e) => sameDay(e.date, day));
        return (
          <div key={isoDate(day)} className="rounded-xl border border-slate-100 bg-slate-50/50 p-2">
            <div className={`mb-2 rounded-md px-2 py-1 text-center text-xs font-medium capitalize ${sameDay(day, today) ? "bg-emerald-600 text-white" : "text-slate-600"}`}>
              {day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: vue === "jour" ? "long" : undefined })}
            </div>
            <div className="space-y-1.5">
              {dayEvents.map((e) => (
                <EventCard key={`${e.kind}-${e.id}`} event={e} />
              ))}
              {dayEvents.length === 0 && <div className="py-2 text-center text-[11px] text-slate-300">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({ range, events, today }: { range: { start: Date; end: Date }; events: Awaited<ReturnType<typeof getPlanningEvents>>; today: Date }) {
  // Grille complète lundi-dimanche englobant le mois (jours hors mois grisés).
  const firstDayOfMonth = range.start;
  const gridStart = new Date(firstDayOfMonth);
  const offset = firstDayOfMonth.getDay() === 0 ? 6 : firstDayOfMonth.getDay() - 1;
  gridStart.setDate(gridStart.getDate() - offset);

  const weeks: Date[][] = [];
  let cursor = new Date(gridStart);
  while (cursor < range.end || weeks.length < 5) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (cursor >= range.end && weeks.length >= 4) break;
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
          <div key={d} className="px-2 py-2">
            {d}
          </div>
        ))}
      </div>
      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-slate-100 border-b border-slate-100 last:border-b-0">
            {week.map((day) => {
              const inMonth = day.getMonth() === firstDayOfMonth.getMonth();
              const dayEvents = events.filter((e) => sameDay(e.date, day));
              return (
                <Link
                  key={isoDate(day)}
                  href={buildHref({ vue: "jour", date: isoDate(day) })}
                  className={`min-h-24 p-1.5 text-xs hover:bg-slate-50 ${inMonth ? "" : "bg-slate-50/50 text-slate-300"}`}
                >
                  <div className={`mb-1 text-right ${sameDay(day, today) ? "font-bold text-emerald-600" : ""}`}>{day.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e) => (
                      <div key={`${e.kind}-${e.id}`} className="truncate rounded bg-white px-1 py-0.5 text-[10px] text-slate-600 shadow-sm">
                        {e.titre}
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div className="text-[10px] text-slate-400">+{dayEvents.length - 3}</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}
