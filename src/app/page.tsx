import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import { typeTacheLabels } from "@/lib/dossier-labels";

export default async function DashboardPage() {
  const dossiers = await prisma.dossier.findMany({
    where: { statut: { key: { not: "CLOTURE" } } },
    select: {
      statutId: true,
      statut: { select: { label: true } },
      montantDevisTTC: true,
      montantAideMPR: true,
      montantAideCEE: true,
      montantEncaisseClient: true,
      montantEncaisseMPR: true,
      montantEncaisseCEE: true,
    },
  });

  const totaux = dossiers.reduce(
    (acc, d) => {
      const resteACharge = d.montantDevisTTC - d.montantAideMPR - d.montantAideCEE;
      acc.restantDuClient += Math.max(resteACharge - d.montantEncaisseClient, 0);
      acc.restantDuMPR += Math.max(d.montantAideMPR - d.montantEncaisseMPR, 0);
      acc.restantDuCEE += Math.max(d.montantAideCEE - d.montantEncaisseCEE, 0);
      return acc;
    },
    { restantDuClient: 0, restantDuMPR: 0, restantDuCEE: 0 }
  );

  const parStatut = dossiers.reduce<Record<string, { label: string; count: number }>>((acc, d) => {
    if (!acc[d.statutId]) acc[d.statutId] = { label: d.statut.label, count: 0 };
    acc[d.statutId].count += 1;
    return acc;
  }, {});

  const tachesEnRetard = await prisma.tache.findMany({
    where: { statut: "A_FAIRE", dateEcheance: { lt: new Date() } },
    include: { dossier: { include: { client: true } } },
    orderBy: { dateEcheance: "asc" },
    take: 10,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Trésorerie</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TresorerieCard label="Restant dû par les clients" value={totaux.restantDuClient} />
        <TresorerieCard label="Restant dû MPR / ANAH" value={totaux.restantDuMPR} />
        <TresorerieCard label="Restant dû CEE" value={totaux.restantDuCEE} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-neutral-900">Dossiers par statut</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(parStatut).map(([statutId, { label, count }]) => (
            <Link
              key={statutId}
              href={`/dossiers?statut=${statutId}`}
              className="rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400"
            >
              <p className="text-2xl font-semibold text-neutral-900">{count}</p>
              <p className="text-sm text-neutral-500">{label}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-neutral-900">Relances en retard</h2>
          <Link href="/taches" className="text-sm text-neutral-500 hover:text-neutral-900">
            Voir toutes les tâches →
          </Link>
        </div>
        {tachesEnRetard.length === 0 ? (
          <p className="text-sm text-neutral-500">Aucune relance en retard.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {tachesEnRetard.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/dossiers/${t.dossierId}`} className="font-medium text-neutral-900 hover:underline">
                        {t.dossier.client.prenom} {t.dossier.client.nom}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{typeTacheLabels[t.type]}</td>
                    <td className="px-4 py-3 text-neutral-600">{t.titre}</td>
                    <td className="px-4 py-3 text-red-600">
                      {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TresorerieCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{formatCents(value)}</p>
    </div>
  );
}
