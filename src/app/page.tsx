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
      dateFinTravaux: true,
      delegataireCee: { select: { id: true, nom: true } },
      postesTravaux: {
        select: {
          montantMaterielHTCts: true,
          montantMaterielTTCCts: true,
          montantPoseSousTraitanceCts: true,
          montantRegieCts: true,
          sousTraitant: { select: { id: true, nom: true, delaiPaiementJours: true } },
        },
      },
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

  let margeNetteTotale = 0;
  const dusParSousTraitant = new Map<
    string,
    { nom: string; montant: number; delaiPaiementJours: number | null }
  >();
  for (const d of dossiers) {
    const totalCouts = d.postesTravaux.reduce(
      (sum, p) =>
        sum +
        (p.montantMaterielTTCCts ?? p.montantMaterielHTCts ?? 0) +
        (p.montantPoseSousTraitanceCts ?? 0) +
        (p.montantRegieCts ?? 0),
      0
    );
    margeNetteTotale += d.montantDevisTTC - totalCouts;

    for (const p of d.postesTravaux) {
      if (p.sousTraitant && p.montantPoseSousTraitanceCts) {
        const existing = dusParSousTraitant.get(p.sousTraitant.id);
        if (existing) existing.montant += p.montantPoseSousTraitanceCts;
        else
          dusParSousTraitant.set(p.sousTraitant.id, {
            nom: p.sousTraitant.nom,
            montant: p.montantPoseSousTraitanceCts,
            delaiPaiementJours: p.sousTraitant.delaiPaiementJours,
          });
      }
    }
  }

  const resteAPercevoirCEEParDelegataire = new Map<string, { nom: string; montant: number }>();
  for (const d of dossiers) {
    const resteCEE = d.montantAideCEE - d.montantEncaisseCEE;
    if (resteCEE <= 0) continue;
    const key = d.delegataireCee?.id ?? "sans-delegataire";
    const nom = d.delegataireCee?.nom ?? "Sans délégataire renseigné";
    const existing = resteAPercevoirCEEParDelegataire.get(key);
    if (existing) existing.montant += resteCEE;
    else resteAPercevoirCEEParDelegataire.set(key, { nom, montant: resteCEE });
  }

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <TresorerieCard label="Restant dû par les clients" value={totaux.restantDuClient} />
        <TresorerieCard label="Restant dû MPR / ANAH" value={totaux.restantDuMPR} />
        <TresorerieCard label="Restant dû CEE" value={totaux.restantDuCEE} />
        <TresorerieCard label="Marge nette (tous dossiers)" value={margeNetteTotale} />
      </div>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Montant dû aux sous-traitants</h2>
          {dusParSousTraitant.size === 0 ? (
            <p className="text-sm text-neutral-400">Rien dû actuellement.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Array.from(dusParSousTraitant.values())
                .sort((a, b) => b.montant - a.montant)
                .map((d) => (
                  <li key={d.nom} className="flex justify-between text-neutral-700">
                    <span>
                      {d.nom}
                      {d.delaiPaiementJours ? ` (délai ${d.delaiPaiementJours} j)` : ""}
                    </span>
                    <span className="font-medium">{formatCents(d.montant)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Reste à percevoir CEE par délégataire</h2>
          {resteAPercevoirCEEParDelegataire.size === 0 ? (
            <p className="text-sm text-neutral-400">Rien à percevoir actuellement.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Array.from(resteAPercevoirCEEParDelegataire.values())
                .sort((a, b) => b.montant - a.montant)
                .map((d) => (
                  <li key={d.nom} className="flex justify-between text-neutral-700">
                    <span>{d.nom}</span>
                    <span className="font-medium">{formatCents(d.montant)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

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
