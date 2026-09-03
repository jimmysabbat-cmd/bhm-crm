import Link from "next/link";
import { Users, Landmark, Zap, TrendingUp, AlertTriangle, ArrowRight, Plus, HandCoins } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { typeTacheLabels } from "@/lib/dossier-labels";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { statutColor } from "@/components/ui/Badge";

export default async function DashboardPage() {
  const ctx = await requireUserContext();
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: ctx.organisationId, statut: { key: { not: "CLOTURE" } } },
    select: {
      statutId: true,
      statut: { select: { label: true, key: true } },
      montantDevisTTC: true,
      montantAideMPR: true,
      montantAideCEE: true,
      montantEncaisseClient: true,
      montantEncaisseMPR: true,
      montantEncaisseCEE: true,
      dateFinTravaux: true,
      type: { select: { key: true } },
      modePaiementAide: { select: { key: true, label: true } },
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

  // Dossiers où BHM avance l'intégralité de l'installation en tant que
  // mandataire : ce que l'ANAH (et le CEE) doit encore verser à BHM, pas au
  // client — vue séparée du "Restant dû" général, et scindée ampleur/monogeste
  // car ce sont deux guichets ANAH différents.
  const MANDATAIRE_KEYS = new Set(["MANDATAIRE_FINANCIER_BHM", "MANDATAIRE_FINANCIER_ANAH"]);
  const mandataire = dossiers.reduce(
    (acc, d) => {
      if (!d.modePaiementAide || !MANDATAIRE_KEYS.has(d.modePaiementAide.key)) return acc;
      const resteMPR = Math.max(d.montantAideMPR - d.montantEncaisseMPR, 0);
      const resteCEE = Math.max(d.montantAideCEE - d.montantEncaisseCEE, 0);
      const isAmpleur = d.type.key.startsWith("RENOVATION_AMPLEUR");
      if (isAmpleur) acc.ampleurMPR += resteMPR;
      else acc.monogesteMPR += resteMPR;
      acc.cee += resteCEE;
      acc.count += 1;
      return acc;
    },
    { ampleurMPR: 0, monogesteMPR: 0, cee: 0, count: 0 }
  );

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

  const parStatut = dossiers.reduce<Record<string, { label: string; key: string; count: number }>>(
    (acc, d) => {
      if (!acc[d.statutId]) acc[d.statutId] = { label: d.statut.label, key: d.statut.key, count: 0 };
      acc[d.statutId].count += 1;
      return acc;
    },
    {}
  );
  const statutEntries = Object.entries(parStatut).sort((a, b) => b[1].count - a[1].count);
  const maxStatutCount = Math.max(1, ...statutEntries.map(([, v]) => v.count));

  const tachesEnRetard = await prisma.tache.findMany({
    where: {
      statut: "A_FAIRE",
      dateEcheance: { lt: new Date() },
      dossier: { organisationId: ctx.organisationId },
    },
    include: { dossier: { include: { client: true } } },
    orderBy: { dateEcheance: "asc" },
    take: 10,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tableau de bord</h1>
          <p className="mt-1 text-sm text-slate-500">Vue d&apos;ensemble de l&apos;activité en cours</p>
        </div>
        <Link href="/dossiers/new">
          <Button>
            <Plus className="h-4 w-4" />
            Nouveau dossier
          </Button>
        </Link>
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

      {mandataire.count > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Mandataire — ce qui reste à me verser
            </h2>
            <span className="text-xs text-slate-400">
              {mandataire.count} dossier{mandataire.count > 1 ? "s" : ""} où j&apos;ai avancé
              l&apos;installation
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="ANAH me doit (rénovation d'ampleur)"
              value={mandataire.ampleurMPR}
              icon={Landmark}
              tone="blue"
            />
            <StatCard
              label="ANAH me doit (monogeste)"
              value={mandataire.monogesteMPR}
              icon={Landmark}
              tone="violet"
            />
            <StatCard
              label="CEE me doit (mandataire)"
              value={mandataire.cee}
              icon={Zap}
              tone="amber"
            />
          </div>
        </section>
      )}

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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Dossiers par statut</h2>
          <span className="text-xs text-slate-400">{dossiers.length} dossier{dossiers.length > 1 ? "s" : ""} en cours</span>
        </div>
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {statutEntries.map(([statutId, { label, key, count }]) => (
            <Link
              key={statutId}
              href={`/dossiers?statut=${statutId}`}
              className="flex items-center gap-4 px-5 py-3 transition hover:bg-slate-50/70"
            >
              <span className="w-44 shrink-0 truncate text-sm font-medium text-slate-700">{label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full ${barColors[statutColor(key)]}`}
                  style={{ width: `${Math.max((count / maxStatutCount) * 100, 4)}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-sm font-semibold text-slate-900">{count}</span>
            </Link>
          ))}
          {statutEntries.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun dossier actif.</p>
          )}
        </Card>
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
  violet: "bg-violet-100 text-violet-600",
};

const barColors: Record<string, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
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
