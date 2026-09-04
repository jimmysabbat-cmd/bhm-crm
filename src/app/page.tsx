import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Landmark,
  Zap,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Plus,
  HandCoins,
  Lock,
  Wallet,
  CalendarClock,
  FileCheck,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, isPartnerRole, NoActiveTenantError, TenantSuspendedError } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { typeTacheLabels } from "@/lib/dossier-labels";
import { getNextBestActions, estCetteSemaine } from "@/lib/next-best-action";
import { calculateBlockedAmountByFlux } from "@/lib/finance";
import { getMargesDossiers, getMouvementsNonSoldes, getEntreeLignesForOrganisation } from "@/lib/financial-engine";
import { getDocumentAdminDashboard } from "@/lib/documents/dashboard";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, statutColor } from "@/components/ui/Badge";

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch (error) {
    // P12 - un PLATFORM SUPER ADMIN sans tenant actif n'a pas de tableau de
    // bord "métier" : on le renvoie vers /platform plutôt que l'écran d'erreur.
    if (error instanceof NoActiveTenantError) redirect("/platform");
    // P12 (section 54) - un tenant suspendu doit bloquer proprement ses
    // utilisateurs, sans écran d'erreur générique.
    if (error instanceof TenantSuspendedError) {
      return (
        <div className="flex h-full min-h-[60vh] items-center justify-center">
          <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
            <h1 className="text-lg font-semibold text-amber-900">Accès suspendu</h1>
            <p className="mt-2 text-sm text-amber-800">
              L&apos;accès de votre organisation a été temporairement suspendu. Contactez votre
              administrateur pour plus d&apos;informations.
            </p>
          </div>
        </div>
      );
    }
    throw error;
  }
  // P11 (section 23/24) - un compte partenaire n'a jamais accès au
  // tableau de bord interne (marge, finances, tous dossiers...) : il est
  // redirigé vers son espace très restreint.
  if (isPartnerRole(ctx)) redirect("/partenaire");
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

  // Moteur Next Best Action - toutes les actions de l'organisation (vue
  // globale), pour le bloc "À traiter en priorité" + les compteurs. Aucune
  // valeur codée en dur : tout vient du moteur (cf. section 14 du prompt P5).
  const toutesLesActions = await getNextBestActions({ organisationId: ctx.organisationId, scope: "all" });
  const topActions = toutesLesActions.slice(0, 8);
  const argentBloqueParFlux = await calculateBlockedAmountByFlux(ctx.organisationId);

  const compteurs = {
    actionsEnRetard: toutesLesActions.filter((a) => a.joursRetard > 0).length,
    dossiersBloques: new Set(
      toutesLesActions.filter((a) => a.typeAction === "ETAPE" && a.statut === "BLOQUE").map((a) => a.dossierId)
    ).size,
    montantBloqueTotal: argentBloqueParFlux.reduce((sum, f) => sum + f.montantBloqueCts, 0),
    encaissementsEnRetard: toutesLesActions.filter(
      (a) => a.typeAction === "MOUVEMENT_FINANCIER" && a.mouvementType === "ENTREE"
    ).length,
    paiementsSemaine: toutesLesActions.filter(
      (a) => a.typeAction === "MOUVEMENT_FINANCIER" && a.mouvementType === "SORTIE" && estCetteSemaine(a)
    ).length,
  };

  // Indicateurs du moteur financier (P6, section 23 ; couche centrale
  // unifiée par P6B section 4/5 - mêmes fonctions que /finances) - masqués
  // aux rôles sans VIEW_FINANCIAL_SUMMARY, sous-masqués pour marge/coûts
  // internes. Aucune valeur codée en dur : tout vient de financial-engine.ts.
  const peutVoirFinances = hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY");
  const peutVoirMarge = hasPermission(ctx, "VIEW_MARGIN");
  const peutVoirCoutsInternes = hasPermission(ctx, "VIEW_INTERNAL_COSTS");
  const [margesDossiers, entreesNonSoldees, sortiesNonSoldees] = peutVoirFinances
    ? await Promise.all([
        getMargesDossiers(ctx.organisationId),
        getEntreeLignesForOrganisation(ctx.organisationId),
        peutVoirCoutsInternes ? getMouvementsNonSoldes(ctx.organisationId, "SORTIE") : Promise.resolve([]),
      ])
    : [[], [], []];

  const indicateursFinanciers = {
    caContractuelActifCts: margesDossiers.reduce((s, d) => s + d.caContractuelCts, 0),
    totalAEncaisserCts: margesDossiers.reduce((s, d) => s + d.resteAEncaisserCts, 0),
    encaissementsEnRetard: entreesNonSoldees.filter((m) => m.enRetard).length,
    totalAPayerCts: sortiesNonSoldees.reduce((s, m) => s + m.resteCts, 0),
    margePrevisionnelleCts: margesDossiers.reduce((s, d) => s + d.margePrevisionnelleCts, 0),
    margeSurCoutsReelsCts: margesDossiers.reduce((s, d) => s + d.margeSurCoutsReelsCts, 0),
    creancesOuvertesCts: margesDossiers.reduce((s, d) => s + d.creancesCts, 0),
  };

  // Dashboard administratif documentaire (P10, section 26).
  const peutVoirDocuments = hasPermission(ctx, "VIEW_DOCUMENTS");
  const documentsAdmin = peutVoirDocuments ? await getDocumentAdminDashboard(ctx.organisationId) : null;

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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">À traiter en priorité</h2>
          <Link
            href="/taches?vue=tout"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-700"
          >
            Voir toutes les actions <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <CountCard label="Actions en retard" value={compteurs.actionsEnRetard} icon={AlertTriangle} tone="red" />
          <CountCard label="Dossiers bloqués" value={compteurs.dossiersBloques} icon={Lock} tone="amber" />
          <StatCard
            label="Montant potentiellement bloqué"
            value={compteurs.montantBloqueTotal}
            icon={Wallet}
            tone="violet"
          />
          <CountCard
            label="Encaissements en retard"
            value={compteurs.encaissementsEnRetard}
            icon={HandCoins}
            tone="blue"
          />
          <CountCard
            label="Paiements à effectuer cette semaine"
            value={compteurs.paiementsSemaine}
            icon={CalendarClock}
            tone="slate"
          />
        </div>

        {topActions.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-slate-400">Aucune action prioritaire actuellement.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {topActions.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Badge color={NIVEAU_COLOR[a.niveauUrgence]}>{a.niveauUrgence}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={a.route} className="font-medium text-slate-900 hover:text-emerald-700">
                        {a.client}
                      </Link>
                      <p className="text-xs text-slate-400">{a.referenceDossier}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{a.titre}</td>
                    <td className="px-4 py-3">
                      {a.dateEcheance ? (
                        <span
                          className={`flex items-center gap-1.5 ${
                            a.joursRetard > 0 ? "text-red-600" : "text-slate-500"
                          }`}
                        >
                          {a.joursRetard > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
                          {a.dateEcheance.toLocaleDateString("fr-FR")}
                          {a.joursRetard > 0 && ` (+${a.joursRetard} j)`}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {a.montantBloqueCts > 0 ? formatCents(a.montantBloqueCts) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={a.route}
                        className="flex items-center justify-end gap-0.5 text-xs font-medium text-slate-400 hover:text-slate-700"
                      >
                        Ouvrir <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Argent bloqué par flux</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 divide-y divide-slate-100 p-5 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {argentBloqueParFlux.map((f) => (
              <div key={f.flux} className="px-4 py-3 first:pl-0 sm:py-0">
                <p className="text-xs text-slate-400">{f.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{formatCents(f.montantBloqueCts)}</p>
                <p className="text-xs text-slate-400">
                  {f.nombreDossiers} dossier{f.nombreDossiers > 1 ? "s" : ""}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {peutVoirFinances && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Moteur financier</h2>
            <Link href="/finances" className="flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-700">
              Voir /finances <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="CA contractuel actif" value={indicateursFinanciers.caContractuelActifCts} icon={TrendingUp} tone="slate" />
            <StatCard label="Total à encaisser" value={indicateursFinanciers.totalAEncaisserCts} icon={Landmark} tone="blue" />
            <StatCard label="Créances ouvertes" value={indicateursFinanciers.creancesOuvertesCts} icon={Wallet} tone="violet" />
            <CountCard label="Encaissements en retard" value={indicateursFinanciers.encaissementsEnRetard} icon={AlertTriangle} tone="red" />
            {peutVoirCoutsInternes && (
              <StatCard label="Total à payer" value={indicateursFinanciers.totalAPayerCts} icon={HandCoins} tone="amber" />
            )}
            {peutVoirMarge && (
              <StatCard label="Marge prévisionnelle" value={indicateursFinanciers.margePrevisionnelleCts} icon={TrendingUp} tone="emerald" />
            )}
            {peutVoirMarge && (
              <StatCard label="Marge sur coûts réels connus" value={indicateursFinanciers.margeSurCoutsReelsCts} icon={TrendingUp} tone="emerald" />
            )}
          </div>
        </section>
      )}

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

      {documentsAdmin && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Documents (P10)</h2>
            <Link href="/documents/a-verifier" className="flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-700">
              Voir les documents à vérifier <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <CountCard label="Dossiers bloqués par pièces" value={documentsAdmin.dossiersBloquesParPieces} icon={FileCheck} tone="red" />
            <CountCard label="Pièces à vérifier" value={documentsAdmin.piecesAVerifier} icon={FileCheck} tone="amber" />
            <CountCard label="Pièces refusées" value={documentsAdmin.piecesRefusees} icon={FileCheck} tone="red" />
            <CountCard label="Pièces expirées" value={documentsAdmin.piecesExpirees} icon={FileCheck} tone="red" />
            <CountCard label="Packages prêts" value={documentsAdmin.packagesPrets} icon={FileCheck} tone="emerald" />
            <CountCard label="Packages en brouillon" value={documentsAdmin.packagesBrouillon} icon={FileCheck} tone="slate" />
          </div>
        </section>
      )}
    </div>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-600",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  red: "bg-red-100 text-red-600",
};

const NIVEAU_COLOR: Record<string, "slate" | "blue" | "amber" | "red"> = {
  BASSE: "slate",
  NORMALE: "blue",
  HAUTE: "amber",
  CRITIQUE: "red",
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

function CountCard({
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
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </Card>
  );
}
