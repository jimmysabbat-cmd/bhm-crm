import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { getPilotagePoses, etapePoseLabels, type EtapePose, type LignePose } from "@/lib/poses/pilotage";
import { Card } from "@/components/ui/Card";

const ORDRE: EtapePose[] = ["A_AFFECTER", "ATTENTE_REPONSE", "A_PLANIFIER", "PLANIFIEE", "EN_COURS", "A_FACTURER", "FACTURE_ST_ATTENDUE", "A_PAYER"];
const URGENT = new Set<EtapePose>(["A_AFFECTER", "A_PLANIFIER", "A_FACTURER"]);

function fmt(d: Date | null) {
  return d ? d.toLocaleDateString("fr-FR") : "—";
}

export default async function PosesPage({ searchParams }: { searchParams: Promise<{ circuit?: string }> }) {
  const ctx = await requireUserContext();
  if (isPartnerRole(ctx)) redirect("/");
  const { circuit } = await searchParams;

  const toutes = await getPilotagePoses(ctx.organisationId);
  const lignes = toutes.filter((l) =>
    circuit === "do" ? l.donneurOrdre != null : circuit === "regie" ? l.circuit === "REGIE" : circuit === "st" ? l.circuit === "SOUS_TRAITANT" : true
  );
  const parEtape = new Map<EtapePose, LignePose[]>(ORDRE.map((e) => [e, []]));
  for (const l of lignes) parEtape.get(l.etape)!.push(l);

  const filtre = (key: string | undefined, label: string) => (
    <Link
      href={key ? `/poses?circuit=${key}` : "/poses"}
      className={`rounded-full border px-3 py-1 text-sm ${circuit === key ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pilotage des poses</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chaque pose, de l&apos;affectation au paiement : chantiers reçus de donneurs d&apos;ordre et nos propres dossiers, posés par l&apos;équipe interne ou confiés à un sous-traitant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDRE.map((e) => (
          <a key={e} href={`#${e}`} className={`rounded-xl border p-3 hover:bg-slate-50 ${URGENT.has(e) && parEtape.get(e)!.length > 0 ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
            <div className="text-2xl font-semibold text-slate-900">{parEtape.get(e)!.length}</div>
            <div className="text-xs text-slate-500">{etapePoseLabels[e]}</div>
          </a>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {filtre(undefined, "Toutes")}
        {filtre("do", "Pour des donneurs d'ordre")}
        {filtre("regie", "Équipe interne")}
        {filtre("st", "Sous-traitants")}
      </div>

      {ORDRE.filter((e) => parEtape.get(e)!.length > 0).map((e) => (
        <section key={e} id={e} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {etapePoseLabels[e]} ({parEtape.get(e)!.length})
          </h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {parEtape.get(e)!.map((l) => (
                  <tr key={l.posteId} className="border-t border-slate-100 first:border-0 hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link href={`/dossiers/${l.dossierId}`} className="font-medium text-slate-900 hover:text-emerald-700">
                        {l.clientLabel}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {l.dossierReference}
                        {l.ville ? ` · ${l.ville}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {l.prestation}
                      {l.surfaceM2 ? ` · ${l.surfaceM2} m²` : ""}
                      {l.donneurOrdre && <div className="text-xs text-amber-700">Pour {l.donneurOrdre}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {l.poseur ?? <span className="text-slate-400">non affectée</span>}
                      {l.circuit && <div className="text-xs text-slate-400">{l.circuit === "REGIE" ? "équipe interne" : "sous-traitant"}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {l.dateDebut || l.dateFin ? `${fmt(l.dateDebut)} → ${fmt(l.dateFin)}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/dossiers/${l.dossierId}#${e === "A_FACTURER" || e === "A_PAYER" || e === "FACTURE_ST_ATTENDUE" ? "factures" : "missions"}`}
                        className="text-xs font-medium text-emerald-700 hover:underline"
                      >
                        {e === "A_AFFECTER" ? "Affecter" : e === "A_FACTURER" ? "Facturer" : e === "A_PAYER" ? "Payer" : "Ouvrir"} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
      {lignes.length === 0 && <p className="text-sm text-slate-400">Aucune pose en cours.</p>}
    </div>
  );
}
