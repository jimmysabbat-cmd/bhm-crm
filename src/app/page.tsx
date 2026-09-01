import Link from "next/link";
import { Users, Landmark, Zap, TrendingUp, AlertTriangle, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import { typeTacheLabels } from "@/lib/dossier-labels";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";

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
    <div className="mx-auto max-w-6xl space-y-8 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Trésorerie</h1>
        <p className="mt-1 text-sm text-slate-500">Vue d&apos;ensemble de l&apos;activité en cours</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Restant dû par les clients"
          value={totaux.restantDuClient}
          icon={Users}
          tone="slate"
        />
        <StatCard
          label="Restant dû MPR / ANAH"
          value={totaux.restantDuMPR}
          icon={Landmark}
          tone="blue"
        />
        <StatCard label="Restant dû CEE" value={totaux.restantDuCEE} icon={Zap} tone="amber" />
        <StatCard
          label="Marge nette (tous dossiers)"
          value={margeNetteTotale}
          icon={TrendingUp}
          tone="emerald"
        />
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Montant dû aux sous-traitants</CardTitle>
          </CardHeader>
          <div className="p-5">
            {dusParSousTraitant.size === 0 ? (
              <p className="text-sm text-slate-400">Rien dû actuellement.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {Array.from(dusParSousTraitant.values())
                  .sort((a, b) => b.montant - a.montant)
                  .map((d) => (
                    <li key={d.nom} className="flex items-center justify-between">
                      <span className="text-slate-600">
                        {d.nom}
                        {d.delaiPaiementJours && (
                          <span className="ml-1.5 text-xs text-slate-400">
                            (délai {d.delaiPaiementJours} j)
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-slate-900">{formatCents(d.montant)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reste à percevoir CEE par délégataire</CardTitle>
          </CardHeader>
          <div className="p-5">
            {resteAPercevoirCEEParDelegataire.size === 0 ? (
              <p className="text-sm text-slate-400">Rien à percevoir actuellement.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {Array.from(resteAPercevoirCEEParDelegataire.values())
                  .sort((a, b) => b.montant - a.montant)
                  .map((d) => (
                    <li key={d.nom} className="flex items-center justify-between">
                      <span className="text-slate-600">{d.nom}</span>
                      <span className="font-semibold text-slate-900">{formatCents(d.montant)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Dossiers par statut</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(parStatut).map(([statutId, { label, count }]) => (
            <Link
              key={statutId}
              href={`/dossiers?statut=${statutId}`}
              className="group rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm shadow-slate-200/50 transition hover:border-emerald-200 hover:shadow-md"
            >
              <p className="text-2xl font-semibold text-slate-900">{count}</p>
              <p className="mt-0.5 text-sm text-slate-500 group-hover:text-emerald-700">{label}</p>
            </Link>
          ))}
          {Object.keys(parStatut).length === 0 && (
            <p className="col-span-full text-sm text-slate-400">Aucun dossier actif.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Relances en retard</h2>
          <Link
            href="/taches"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-700"
          >
            Voir toutes les tâches <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {tachesEnRetard.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-slate-400">Aucune relance en retard.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {tachesEnRetard.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <Link
                        href={`/dossiers/${t.dossierId}`}
                        className="font-medium text-slate-900 hover:text-emerald-700"
                      >
                        {t.dossier.client.prenom} {t.dossier.client.nom}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{typeTacheLabels[t.type]}</td>
                    <td className="px-5 py-3 text-slate-500">{t.titre}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-600",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof tones;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
            {formatCents(value)}
          </p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </Card>
  );
}
