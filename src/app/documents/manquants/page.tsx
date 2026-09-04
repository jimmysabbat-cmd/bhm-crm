import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { getMissingDocumentsAcrossOrg } from "@/lib/documents/lists";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, labelClass } from "@/components/ui/field";

export default async function DocumentsManquantsPage({
  searchParams,
}: {
  searchParams: Promise<{ responsable?: string; destination?: string; bloquant?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_DOCUMENTS")) redirect("/");

  const params = await searchParams;
  const all = await getMissingDocumentsAcrossOrg(ctx.organisationId);

  const filtered = all.filter((r) => {
    if (params.responsable && r.responsible !== params.responsable) return false;
    if (params.destination && r.destination !== params.destination) return false;
    if (params.bloquant === "oui" && !r.blocking) return false;
    if (params.bloquant === "non" && r.blocking) return false;
    return true;
  });

  const responsables = Array.from(new Set(all.map((r) => r.responsible).filter((v): v is string => v != null)));
  const destinations = Array.from(new Set(all.map((r) => r.destination).filter((v): v is string => v != null)));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Documents manquants</h1>
          <p className="mt-1 text-sm text-slate-500">{filtered.length} pièce(s) manquante(s){filtered.length !== all.length ? ` (sur ${all.length})` : ""}.</p>
        </div>
        <Link href="/documents/a-verifier" className="text-sm font-medium text-slate-500 hover:text-emerald-700">
          Documents à vérifier →
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" action="/documents/manquants" method="get">
        <div className="space-y-1">
          <label className={labelClass}>Responsable</label>
          <select name="responsable" defaultValue={params.responsable ?? ""} className={inputClass}>
            <option value="">Tous</option>
            {responsables.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Destination</label>
          <select name="destination" defaultValue={params.destination ?? ""} className={inputClass}>
            <option value="">Toutes</option>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Bloquant</label>
          <select name="bloquant" defaultValue={params.bloquant ?? ""} className={inputClass}>
            <option value="">Indifférent</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
          Filtrer
        </button>
      </form>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Dossier</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Pièce</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Bloquant</th>
              <th className="px-4 py-3">Ancienneté</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.dossierId}-${r.typeDocumentNom}-${i}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link href={`/dossiers/${r.dossierId}`} className="font-medium text-slate-900 hover:text-emerald-700">
                    {r.dossierReference}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{r.clientNom}</td>
                <td className="px-4 py-3 text-slate-500">{r.typeDocumentNom}</td>
                <td className="px-4 py-3 text-slate-500">{r.sourceLabel}</td>
                <td className="px-4 py-3 text-slate-500">{r.responsible ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{r.destination ?? "—"}</td>
                <td className="px-4 py-3">{r.blocking ? <Badge color="red">Oui</Badge> : "—"}</td>
                <td className="px-4 py-3 text-slate-500">{r.ancienneteJours} j</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucune pièce manquante.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
