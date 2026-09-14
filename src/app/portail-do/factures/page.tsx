import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/authz";
import { getFacturesForDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { formatCents } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const STATUT_LABELS: Record<string, string> = {
  TRANSMISE: "Transmise",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  EN_RETARD: "En retard",
  ANNULEE: "Annulée",
  LITIGE: "Litige",
  EMISE: "Transmise",
};
const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  TRANSMISE: "blue",
  PARTIELLEMENT_PAYEE: "amber",
  PAYEE: "emerald",
  EN_RETARD: "red",
  ANNULEE: "slate",
  LITIGE: "red",
  EMISE: "blue",
};

export default async function FacturesDoPage() {
  const ctx = await requireUserContext();
  if (ctx.role !== "DONNEUR_ORDRE") redirect("/");
  const factures = await getFacturesForDonneurOrdre(ctx);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Factures</h1>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">N°</th>
              <th className="px-4 py-3">Chantier</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">TTC</th>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3 text-right">Reste dû</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {factures.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="px-5 py-3 font-medium text-slate-900">{f.numero}</td>
                <td className="px-4 py-3 text-slate-600">{f.dossierReference}</td>
                <td className="px-4 py-3 text-slate-500">{f.dateEmission.toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCents(f.montantTTCCts)}</td>
                <td className="px-4 py-3 text-slate-500">{f.dateEcheance ? f.dateEcheance.toLocaleDateString("fr-FR") : "—"}</td>
                <td className="px-4 py-3">
                  <Badge color={STATUT_COLORS[f.statut] ?? "slate"}>{STATUT_LABELS[f.statut] ?? f.statut}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCents(f.resteCts)}</td>
                <td className="px-4 py-3">
                  <a href={`/api/factures/${f.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">
                    Voir / télécharger
                  </a>
                </td>
              </tr>
            ))}
            {factures.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">
                  Aucune facture pour l&apos;instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
