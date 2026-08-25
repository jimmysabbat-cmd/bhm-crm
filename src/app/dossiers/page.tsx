import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import {
  resteAChargeCents,
  statutDossierLabels,
  typeDossierLabels,
} from "@/lib/dossier-labels";
import type { StatutDossier } from "@/generated/prisma/enums";

export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;

  const dossiers = await prisma.dossier.findMany({
    where: statut ? { statut: statut as StatutDossier } : undefined,
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Dossiers</h1>
        <Link
          href="/dossiers/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + Nouveau dossier
        </Link>
      </div>

      {statut && (
        <Link href="/dossiers" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Retirer le filtre « {statutDossierLabels[statut as StatutDossier]} »
        </Link>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Devis TTC</th>
              <th className="px-4 py-3 font-medium">Reste à charge</th>
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => (
              <tr key={d.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <Link href={`/dossiers/${d.id}`} className="font-medium text-neutral-900 hover:underline">
                    {d.client.prenom} {d.client.nom}
                  </Link>
                  <p className="text-xs text-neutral-400">{d.reference}</p>
                </td>
                <td className="px-4 py-3 text-neutral-600">{typeDossierLabels[d.type]}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                    {statutDossierLabels[d.statut]}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-600">{formatCents(d.montantDevisTTC)}</td>
                <td className="px-4 py-3 text-neutral-600">
                  {formatCents(resteAChargeCents(d))}
                </td>
              </tr>
            ))}
            {dossiers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Aucun dossier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
