import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, PhoneCall, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { formatPhoneForDisplay } from "@/lib/phone";
import { calculateLeadQualification } from "@/lib/leads/qualification";
import { getNextLeadToCall } from "@/lib/leads/next-lead";
import { getCommercialDashboardMetrics } from "@/lib/leads/dashboard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { creerLead } from "./lead-actions";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";

const TEMPERATURE_COLOR: Record<string, "slate" | "blue" | "red"> = { FROID: "blue", TIEDE: "slate", CHAUD: "red" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; source?: string; commercial?: string; scope?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_LEADS")) redirect("/");

  const params = await searchParams;
  const peutVoirEquipe = hasPermission(ctx, "VIEW_TEAM_LEADS");
  const scopeMine = params.scope === "mine" || (!peutVoirEquipe && params.scope !== "team");

  const [leads, statuts, sources, commerciaux, nextLead, dashboard, statutFiltre, sourceFiltre] = await Promise.all([
    prisma.lead.findMany({
      where: {
        organisationId: ctx.organisationId,
        ...(params.statut ? { statutId: params.statut } : {}),
        ...(params.source ? { sourceId: params.source } : {}),
        ...(params.commercial ? { commercialId: params.commercial } : {}),
        ...(scopeMine ? { OR: [{ commercialId: ctx.userId }, { teleprospecteurId: ctx.userId }] } : {}),
      },
      include: {
        statut: true,
        source: true,
        commercial: { select: { name: true } },
        teleprospecteur: { select: { name: true } },
        logement: { select: { typeBatiment: true, surfaceHabitableM2: true, anneeConstruction: true, chauffagePrincipal: true } },
        rdvs: { where: { statut: { not: "ANNULE" } }, select: { id: true }, take: 1 },
        interactions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.leadPipelineStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.leadSource.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    peutVoirEquipe ? prisma.user.findMany({ where: { organisationId: ctx.organisationId, actif: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    getNextLeadToCall(ctx),
    getCommercialDashboardMetrics(ctx),
    params.statut ? prisma.leadPipelineStatus.findUnique({ where: { id: params.statut } }) : null,
    params.source ? prisma.leadSource.findUnique({ where: { id: params.source } }) : null,
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            {leads.length} lead{leads.length > 1 ? "s" : ""}
            {statutFiltre ? ` · ${statutFiltre.label}` : ""}
            {sourceFiltre ? ` · ${sourceFiltre.label}` : ""}
          </p>
        </div>
        {hasPermission(ctx, "IMPORT_LEADS") && (
          <Link href="/leads/import" className="text-sm font-medium text-slate-500 hover:text-emerald-700">
            Importer un CSV →
          </Link>
        )}
      </div>

      {/* Dashboard commercial (section 32) */}
      {dashboard && (
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { label: "Nouveaux", value: dashboard.nouveauxLeads },
              { label: "Appels à faire", value: dashboard.appelsAFaire },
              { label: "Rappels en retard", value: dashboard.rappelsEnRetard },
              { label: "RDV aujourd'hui", value: dashboard.rdvAujourdhui },
              { label: "Qualifiés", value: dashboard.leadsQualifies },
              { label: "Études à faire", value: dashboard.etudesAFaire },
              { label: "Devis en attente", value: dashboard.devisEnAttente },
              { label: "Signés", value: dashboard.ventesSignees },
            ].map((m) => (
              <div key={m.label}>
                <p className="text-2xl font-semibold text-slate-900">{m.value}</p>
                <p className="text-xs text-slate-500">{m.label}</p>
              </div>
            ))}
          </div>
          {dashboard.tauxConversionPct != null && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Taux de conversion (signés / non perdus) : <strong>{dashboard.tauxConversionPct} %</strong>
            </p>
          )}
        </Card>
      )}

      {/* Prochain lead à appeler (section 22) */}
      {nextLead && (
        <Card className="border-emerald-200 bg-emerald-50/40 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                <PhoneCall className="h-3.5 w-3.5" />
                Prochain lead à appeler
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {nextLead.prenom} {nextLead.nom} {nextLead.ville ? `· ${nextLead.ville}` : ""}
              </p>
              <p className="text-sm text-slate-500">{nextLead.telephone ?? "Téléphone inconnu"}</p>
              <p className="mt-1 text-xs text-slate-400">{nextLead.reasons.join(" · ")}</p>
            </div>
            <Link href={`/leads/${nextLead.leadId}/qualification`}>
              <Button>Appeler</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Création rapide */}
      <details className="group rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/50">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4">
          <Plus className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-slate-900">Nouveau lead</span>
        </summary>
        <form
          action={async (formData: FormData) => {
            "use server";
            await creerLead(formData);
          }}
          className="grid grid-cols-2 gap-3 border-t border-slate-100 p-5 sm:grid-cols-4"
        >
          <div className="space-y-1">
            <label className={labelClass}>Prénom</label>
            <input name="prenom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="telephone" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Adresse</label>
            <input name="adresse" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Code postal</label>
            <input name="codePostal" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Ville</label>
            <input name="ville" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Source</label>
            <select name="source" className={inputClass} defaultValue="">
              <option value="">—</option>
              {sources.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-4">
            <label className={labelClass}>Notes</label>
            <input name="notes" className={inputClass} />
          </div>
          <div className="col-span-2 sm:col-span-4">
            <Button type="submit">Créer le lead</Button>
          </div>
        </form>
      </details>

      {/* Filtres (section 21) */}
      <form className="flex flex-wrap items-end gap-3" action="/leads" method="get">
        {peutVoirEquipe && (
          <div className="space-y-1">
            <label className={labelClass}>Vue</label>
            <select name="scope" defaultValue={scopeMine ? "mine" : "team"} className={smallInputClass}>
              <option value="mine">Mes leads</option>
              <option value="team">Équipe</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className={labelClass}>Statut</label>
          <select name="statut" defaultValue={params.statut ?? ""} className={smallInputClass}>
            <option value="">Tous</option>
            {statuts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Source</label>
          <select name="source" defaultValue={params.source ?? ""} className={smallInputClass}>
            <option value="">Toutes</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {peutVoirEquipe && (
          <div className="space-y-1">
            <label className={labelClass}>Commercial</label>
            <select name="commercial" defaultValue={params.commercial ?? ""} className={smallInputClass}>
              <option value="">Tous</option>
              {commerciaux.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="secondary" className="text-xs">
          Filtrer
        </Button>
        {(params.statut || params.source || params.commercial) && (
          <Link href="/leads" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-700">
            <ArrowLeft className="h-3 w-3" />
            Réinitialiser
          </Link>
        )}
      </form>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Nom</th>
              <th className="px-4 py-3">Ville</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3">Dernier contact</th>
              <th className="px-4 py-3">Prochaine action</th>
              <th className="px-4 py-3">Commercial</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const qualification = calculateLeadQualification({
                pipelineStatutKey: lead.statut.key,
                temperature: lead.temperature,
                aRdvPlanifie: lead.rdvs.length > 0,
                logement: lead.logement
                  ? { typeBatiment: lead.logement.typeBatiment, surfaceHabitableM2: lead.logement.surfaceHabitableM2, anneeConstruction: lead.logement.anneeConstruction, chauffagePrincipal: lead.logement.chauffagePrincipal }
                  : null,
                nbReponsesQuestionnaire: 0,
                nbQuestionsObligatoiresTotal: 0,
                nbQuestionsObligatoiresRepondues: 0,
              });
              return (
                <tr key={lead.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-5 py-3">
                    <Link href={`/leads/${lead.id}/qualification`} className="font-medium text-slate-900 hover:text-emerald-700">
                      {lead.prenom} {lead.nom}
                    </Link>
                    <Badge color={TEMPERATURE_COLOR[lead.temperature]}>{lead.temperature}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{lead.ville ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatPhoneForDisplay(lead.telephoneNormalise) }</td>
                  <td className="px-4 py-3 text-slate-500">{lead.source?.label ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge>{lead.statut.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{qualification.score}</td>
                  <td className="px-4 py-3 text-slate-500">{lead.interactions[0]?.createdAt.toLocaleDateString("fr-FR") ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{lead.prochainContactAt?.toLocaleDateString("fr-FR") ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{lead.commercial?.name ?? lead.teleprospecteur?.name ?? "—"}</td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucun lead.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
