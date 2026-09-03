import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import { requireUserContext, hasPermission } from "@/lib/authz";
import {
  getEntreeLignesForOrganisation,
  getMouvementsNonSoldes,
  getCreancesForOrganisation,
  getCashflowForecast,
  getMargesDossiers,
  financialDataQualityLabels,
  type LigneEntreeUnifiee,
  type MouvementAvecDossier,
} from "@/lib/financial-engine";
import { formatCents } from "@/lib/money";
import { categorieMouvementLabels, statutMouvementLabels } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, labelClass } from "@/components/ui/field";

// Vue d'affichage commune aux mouvements détaillés et aux lignes virtuelles
// legacy (section 3 du prompt P6B) - évite de dupliquer le rendu pour deux
// formes de données différentes.
type LigneAffichage = {
  id: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  categorieLabel: string;
  partiePrenante: string | null;
  datePrevue: Date | null;
  statutLabel: string;
  resteCts: number;
  enRetard: boolean;
  joursRetard: number;
  precision: "DETAILED" | "LEGACY";
};

function fromEntreeLigne(l: LigneEntreeUnifiee): LigneAffichage {
  return {
    id: l.id,
    dossierId: l.dossierId,
    dossierReference: l.dossierReference,
    clientLabel: l.clientLabel,
    categorieLabel: l.categorieLabel,
    partiePrenante: l.payeur,
    datePrevue: l.datePrevue,
    statutLabel: l.statutLabel,
    resteCts: l.resteCts,
    enRetard: l.enRetard,
    joursRetard: l.joursRetard,
    precision: l.precision,
  };
}

function fromMouvement(m: MouvementAvecDossier): LigneAffichage {
  return {
    id: m.id,
    dossierId: m.dossierId,
    dossierReference: m.dossierReference,
    clientLabel: m.clientLabel,
    categorieLabel: m.categorieLabel,
    partiePrenante: m.payeur ?? m.beneficiaire,
    datePrevue: m.datePrevue,
    statutLabel: statutMouvementLabels[m.statut],
    resteCts: m.resteCts,
    enRetard: m.enRetard,
    joursRetard: m.joursRetard,
    precision: "DETAILED",
  };
}

function matchesFilters(l: LigneAffichage, filtres: { categorieLabel?: string; statutLabel?: string; q?: string }): boolean {
  if (filtres.categorieLabel && l.categorieLabel !== filtres.categorieLabel) return false;
  if (filtres.statutLabel && l.statutLabel !== filtres.statutLabel) return false;
  if (filtres.q) {
    const q = filtres.q.toLowerCase();
    if (!l.dossierReference.toLowerCase().includes(q) && !l.clientLabel.toLowerCase().includes(q)) return false;
  }
  return true;
}

function LigneRow({ l }: { l: LigneAffichage }) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/70">
      <td className="px-4 py-2.5">
        <Link href={`/dossiers/${l.dossierId}#flux-financiers`} className="font-medium text-slate-900 hover:text-emerald-700">
          {l.clientLabel}
        </Link>
        <p className="text-xs text-slate-400">{l.dossierReference}</p>
      </td>
      <td className="px-4 py-2.5 text-slate-500">
        {l.categorieLabel}
        {l.precision === "LEGACY" && <Badge color="amber">legacy</Badge>}
      </td>
      <td className="px-4 py-2.5 text-slate-500">{l.partiePrenante || "—"}</td>
      <td className="px-4 py-2.5">
        {l.datePrevue ? (
          <span className={`flex items-center gap-1.5 ${l.enRetard ? "text-red-600" : "text-slate-500"}`}>
            {l.enRetard && <AlertTriangle className="h-3.5 w-3.5" />}
            {l.datePrevue.toLocaleDateString("fr-FR")}
            {l.enRetard && ` (+${l.joursRetard} j)`}
          </span>
        ) : (
          <span className="text-slate-400">Sans échéance connue</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Badge color="slate">{l.statutLabel}</Badge>
      </td>
      <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCents(l.resteCts)}</td>
    </tr>
  );
}

function LignesTable({ items, empty }: { items: LigneAffichage[]; empty: string }) {
  if (items.length === 0) return <p className="p-5 text-sm text-slate-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Client / dossier</th>
            <th className="px-4 py-2.5">Catégorie</th>
            <th className="px-4 py-2.5">Partie prenante</th>
            <th className="px-4 py-2.5">Échéance</th>
            <th className="px-4 py-2.5">Statut</th>
            <th className="px-4 py-2.5 text-right">Reste</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <LigneRow key={l.id} l={l} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string; statut?: string; q?: string; granularite?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY")) redirect("/");

  const peutVoirCoutsInternes = hasPermission(ctx, "VIEW_INTERNAL_COSTS");
  const peutVoirMarge = hasPermission(ctx, "VIEW_MARGIN");

  const { categorie, statut, q, granularite: granulariteRaw } = await searchParams;
  const filtres = {
    categorieLabel: categorie ? categorieMouvementLabels[categorie as keyof typeof categorieMouvementLabels] : undefined,
    statutLabel: statut ? statutMouvementLabels[statut as keyof typeof statutMouvementLabels] : undefined,
    q,
  };
  const granularite = granulariteRaw === "mois" ? "mois" : "semaine";

  const dateDebut = new Date();
  dateDebut.setHours(0, 0, 0, 0);
  const dateFin = new Date(dateDebut);
  dateFin.setDate(dateFin.getDate() + (granularite === "mois" ? 180 : 56));

  const [entreeLignesBrutes, sortiesBrutes, creances, cashflow, marges] = await Promise.all([
    getEntreeLignesForOrganisation(ctx.organisationId),
    peutVoirCoutsInternes ? getMouvementsNonSoldes(ctx.organisationId, "SORTIE") : Promise.resolve([]),
    getCreancesForOrganisation(ctx.organisationId),
    getCashflowForecast(ctx.organisationId, dateDebut, dateFin, granularite),
    getMargesDossiers(ctx.organisationId),
  ]);

  // Ne montrer que ce qui reste réellement dû (section 3/4 du prompt P6B) -
  // les lignes soldées (resteCts = 0) n'ont rien à faire dans "à encaisser".
  const entreesToutes = entreeLignesBrutes.filter((l) => l.resteCts > 0).map(fromEntreeLigne);
  const sortiesToutes = sortiesBrutes.map(fromMouvement);

  const entrees = entreesToutes.filter((l) => matchesFilters(l, filtres));
  const sorties = sortiesToutes.filter((l) => matchesFilters(l, filtres));
  const entreesAvecEcheance = entrees.filter((l) => l.datePrevue !== null);
  const entreesSansEcheance = entrees.filter((l) => l.datePrevue === null);
  const enRetard = [...entrees, ...sorties].filter((l) => l.enRetard).sort((a, b) => b.joursRetard - a.joursRetard);

  const totalAEncaisser = entrees.reduce((s, l) => s + l.resteCts, 0);
  const totalAPayer = sorties.reduce((s, l) => s + l.resteCts, 0);
  const totalCreances = creances.reduce((s, c) => s + c.resteCts, 0);

  const categoriesPresentes = Array.from(new Set([...entreeLignesBrutes.map((l) => l.categorieRaw), ...sortiesBrutes.map((m) => m.categorie)])).filter(
    (c): c is keyof typeof categorieMouvementLabels => c in categorieMouvementLabels
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Finances</h1>
          <p className="mt-1 text-sm text-slate-500">Moteur financier central - à encaisser, à payer, créances, trésorerie et marges</p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <label className={labelClass}>Dossier / client</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Recherche…" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Catégorie</label>
          <select name="categorie" defaultValue={categorie ?? ""} className={inputClass}>
            <option value="">Toutes</option>
            {categoriesPresentes.map((c) => (
              <option key={c} value={c}>
                {categorieMouvementLabels[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Statut</label>
          <select name="statut" defaultValue={statut ?? ""} className={inputClass}>
            <option value="">Tous</option>
            {Object.entries(statutMouvementLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Trésorerie</label>
          <select name="granularite" defaultValue={granularite} className={inputClass}>
            <option value="semaine">Par semaine (8 sem.)</option>
            <option value="mois">Par mois (6 mois)</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Filtrer
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Total à encaisser</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{formatCents(totalAEncaisser)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Total à payer</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
            {peutVoirCoutsInternes ? formatCents(totalAPayer) : "—"}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Créances ouvertes</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{formatCents(totalCreances)}</p>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">A. À encaisser ({entrees.length})</h2>
        <Card className="overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Avec échéance connue ({entreesAvecEcheance.length})
          </p>
          <LignesTable items={entreesAvecEcheance} empty="Rien avec une échéance connue." />
        </Card>
        <Card className="overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Sans échéance connue ({entreesSansEcheance.length})
          </p>
          <LignesTable items={entreesSansEcheance} empty="Rien sans échéance connue." />
        </Card>
      </section>

      {peutVoirCoutsInternes && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">B. À payer ({sorties.length})</h2>
          <Card className="overflow-hidden">
            <LignesTable items={sorties} empty="Rien à payer." />
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">C. En retard ({enRetard.length})</h2>
        <Card className="overflow-hidden">
          <LignesTable items={enRetard} empty="Aucun retard." />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">D. Créances ({creances.length})</h2>
        <Card className="overflow-hidden">
          {creances.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">Aucune créance ouverte.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Client / dossier</th>
                  <th className="px-4 py-2.5">Origine</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5 text-right">Initial</th>
                  <th className="px-4 py-2.5 text-right">Recouvré</th>
                  <th className="px-4 py-2.5 text-right">Reste</th>
                </tr>
              </thead>
              <tbody>
                {creances.map((c) => (
                  <tr key={c.mouvementId} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link href={`/dossiers/${c.dossierId}#flux-financiers`} className="font-medium text-slate-900 hover:text-emerald-700">
                        {c.clientLabel}
                      </Link>
                      <p className="text-xs text-slate-400">{c.dossierReference}</p>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {c.origine === "LEGACY_AGGREGATE" ? "Agrégat legacy" : c.origine ?? "—"}
                      {c.precision === "LEGACY" && <Badge color="amber">legacy</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge color={c.statut === "EN_RETARD" ? "red" : c.statut === "LITIGE" ? "amber" : "slate"}>{c.statut}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(c.montantInitialCts)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(c.montantRecouvreCts)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCents(c.resteCts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">E. Trésorerie prévisionnelle</h2>
          <span className="text-xs text-slate-400">
            Prévision de flux (reste à percevoir/payer par échéance connue uniquement) - pas un solde bancaire
          </span>
        </div>
        <Card className="overflow-hidden">
          {cashflow.buckets.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">Aucun mouvement daté sur cette période.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Période</th>
                  <th className="px-4 py-2.5 text-right">Entrées</th>
                  <th className="px-4 py-2.5 text-right">Sorties</th>
                  <th className="px-4 py-2.5 text-right">Net</th>
                  <th className="px-4 py-2.5 text-right">Cumul net</th>
                </tr>
              </thead>
              <tbody>
                {cashflow.buckets.map((b) => (
                  <tr key={b.periodeLabel} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{b.periodeLabel}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700">{formatCents(b.entreesCts)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{formatCents(b.sortiesCts)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${b.netCts >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {b.netCts >= 0 ? "+" : ""}
                      {formatCents(b.netCts)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(b.cumulNetCts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cashflow.sansDate.nombreMouvements > 0 && (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
              {cashflow.sansDate.nombreMouvements} mouvement(s) sans date prévue, non inclus ci-dessus (
              {formatCents(cashflow.sansDate.entreesCts)} entrées / {formatCents(cashflow.sansDate.sortiesCts)} sorties à
              planifier) - jamais rattachés à une échéance inventée. Les lignes historiques (legacy, sans date) de la
              section A ne sont pas non plus incluses ici pour la même raison.
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">F. Marges par dossier</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Dossier</th>
                  <th className="px-4 py-2.5">Qualité</th>
                  <th className="px-4 py-2.5 text-right">CA</th>
                  <th className="px-4 py-2.5 text-right">Encaissé</th>
                  <th className="px-4 py-2.5 text-right">Reste à encaisser</th>
                  {peutVoirCoutsInternes && <th className="px-4 py-2.5 text-right">Coût prévu</th>}
                  {peutVoirCoutsInternes && <th className="px-4 py-2.5 text-right">Coût réel</th>}
                  {peutVoirMarge && <th className="px-4 py-2.5 text-right">Marge prévue</th>}
                  {peutVoirMarge && <th className="px-4 py-2.5 text-right">Marge sur coûts réels</th>}
                  <th className="px-4 py-2.5 text-right">Créances</th>
                  {peutVoirCoutsInternes && <th className="px-4 py-2.5 text-right">Dettes</th>}
                </tr>
              </thead>
              <tbody>
                {marges.map((d) => (
                  <tr key={d.dossierId} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link href={`/dossiers/${d.dossierId}`} className="font-medium text-slate-900 hover:text-emerald-700">
                        {d.clientLabel}
                      </Link>
                      <p className="text-xs text-slate-400">{d.reference}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge color={d.financialDataQuality === "DETAILED" ? "emerald" : d.financialDataQuality === "PARTIAL" ? "blue" : d.financialDataQuality === "LEGACY" ? "amber" : "red"}>
                        {financialDataQualityLabels[d.financialDataQuality]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(d.caContractuelCts)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(d.encaisseCts)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(d.resteAEncaisserCts)}</td>
                    {peutVoirCoutsInternes && <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(d.coutPrevuCts)}</td>}
                    {peutVoirCoutsInternes && <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(d.coutReelCts)}</td>}
                    {peutVoirMarge && <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(d.margePrevisionnelleCts)}</td>}
                    {peutVoirMarge && (
                      <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCents(d.margeSurCoutsReelsCts)}</td>
                    )}
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(d.creancesCts)}</td>
                    {peutVoirCoutsInternes && <td className="px-4 py-2.5 text-right text-slate-500">{formatCents(d.dettesCts)}</td>}
                  </tr>
                ))}
                {marges.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                      Aucun dossier actif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-xs text-slate-400">
          « Marge sur coûts réels » compare le CA contractuel à des coûts réellement engagés - ce n&apos;est pas une marge
          réalisée au sens comptable (aucune facturation/reconnaissance de revenu n&apos;existe encore dans le CRM).
        </p>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Wallet className="h-3.5 w-3.5" />
        Toutes les valeurs sont calculées par le moteur financier (src/lib/financial-engine.ts), aucune n&apos;est codée en dur.
        <Link href="/" className="ml-auto flex items-center gap-0.5 text-slate-400 hover:text-emerald-700">
          Tableau de bord <ArrowRight className="h-3 w-3" />
        </Link>
      </p>
    </div>
  );
}
