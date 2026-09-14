import Link from "next/link";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import type { DemandeRow } from "@/lib/donneurs-ordre/access";

// P16 - liste réutilisée par toutes les vues filtrées du portail DO
// (mes-demandes/a-programmer/programmes/en-cours/termines) - une seule
// logique de rendu, jamais dupliquée par onglet.
export function DemandesList({ title, demandes }: { title: string; demandes: DemandeRow[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
        {title} ({demandes.length})
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3">Référence</th>
            <th className="px-4 py-3">Client</th>
            <th className="px-4 py-3">Prestation</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3">Envoyée le</th>
          </tr>
        </thead>
        <tbody>
          {demandes.map((d) => (
            <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-5 py-3 font-medium text-slate-900">
                <Link href={`/portail-do/${d.id}`} className="hover:underline">
                  {d.reference}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {d.clientNom}
                {d.clientVille ? ` — ${d.clientVille}` : ""}
              </td>
              <td className="px-4 py-3 text-slate-600">{d.postes.map((p) => typeTravauxLabels[p.type as keyof typeof typeTravauxLabels] ?? p.type).join(", ") || "—"}</td>
              <td className="px-4 py-3 text-slate-600">{d.statutLabel}</td>
              <td className="px-4 py-3 text-slate-500">{d.createdAt.toLocaleDateString("fr-FR")}</td>
            </tr>
          ))}
          {demandes.length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                Aucune demande pour l&apos;instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
