import { requirePlatformContext } from "@/lib/authz";
import { getPlatformOrganisations } from "@/lib/platform/organisations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, labelClass } from "@/components/ui/field";
import { createOrganisationAction } from "../actions";
import { OrganisationActions } from "./OrganisationActions";

// ============================================================
// /platform/organisations (P12, sections 14/15/16) - créer/suspendre/
// activer/archiver/entrer. Réservé PLATFORM SUPER ADMIN.
// ============================================================

export default async function PlatformOrganisationsPage() {
  await requirePlatformContext();
  const orgs = await getPlatformOrganisations();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Organisations</h1>
        <p className="mt-1 text-sm text-slate-500">{orgs.length} tenant(s).</p>
      </div>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        {orgs.map((o) => (
          <div key={o.id} className="space-y-2 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">{o.nom}</p>
                <p className="text-xs text-slate-400">
                  {o.slug} · {o._count.users} utilisateur(s) · {o._count.dossiers} dossier(s) · {o._count.clients} client(s) · {o._count.leads} lead(s)
                </p>
              </div>
              <Badge color={o.status === "ACTIVE" ? "emerald" : o.status === "SUSPENDED" ? "amber" : "slate"}>{o.status}</Badge>
            </div>
            <OrganisationActions organisationId={o.id} status={o.status} />
          </div>
        ))}
        {orgs.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Aucune organisation.</div>}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Créer une organisation</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            await createOrganisationAction(formData);
          }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="space-y-1">
            <label className={labelClass}>Nom *</label>
            <input name="nom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Raison sociale</label>
            <input name="raisonSociale" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>SIRET</label>
            <input name="siret" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>TVA</label>
            <input name="tva" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Adresse</label>
            <input name="adresse" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="telephone" className={inputClass} />
          </div>
          <div className="col-span-2 flex items-center gap-2 pt-2">
            <input type="checkbox" name="withTemplate" id="withTemplate" defaultChecked className="h-4 w-4 rounded border-slate-300" />
            <label htmlFor="withTemplate" className="text-sm text-slate-600">
              Initialiser avec les automatisations par défaut (recommandé)
            </label>
          </div>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
              Créer
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
