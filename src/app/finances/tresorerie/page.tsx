import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, AlertTriangle, Download, Scale } from "lucide-react";
import { requireUserContext, hasPermission, isPartnerRole } from "@/lib/authz";
import {
  getLignesTresorerie,
  syntheseParContrepartie,
  echeancierMensuel,
  getRealiseParMois,
  getReglementsRecents,
  contrepartieTypeLabels,
  type ContrepartieType,
  type LigneTreso,
  type SyntheseContrepartie,
} from "@/lib/tresorerie";
import { formatCents } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { PointageForm, type LignePointable } from "./PointageForm";

type Vue = "contreparties" | "echeancier" | "realise";

const TYPES_ENTREE: ContrepartieType[] = ["ANAH", "CEE", "CLIENT", "DONNEUR_ORDRE", "AUTRE"];
const TYPES_SORTIE: ContrepartieType[] = ["SOUS_TRAITANT", "FOURNISSEUR", "REGIE", "AUTRE"];

function Kpi({ label, value, sub, tone, icon: Icon }: { label: string; value: string; sub?: string; tone: "emerald" | "rose" | "slate" | "amber"; icon: typeof Scale }) {
  const tones = { emerald: "text-emerald-600 bg-emerald-50", rose: "text-rose-600 bg-rose-50", slate: "text-slate-600 bg-slate-100", amber: "text-amber-600 bg-amber-50" };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span className={`rounded-lg p-1.5 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

function TableContreparties({ titre, rows, sens }: { titre: string; rows: SyntheseContrepartie[]; sens: "ENTREE" | "SORTIE" }) {
  const total = rows.reduce((s, r) => s + r.resteCts, 0);
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline justify-between text-sm font-semibold text-slate-900">
        <span>{titre}</span>
        <span className="text-slate-500">{formatCents(total)}</span>
      </h2>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">Rien en attente.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Contrepartie</th>
                <th className="px-4 py-2.5 text-right">En retard</th>
                <th className="px-4 py-2.5 text-right">Sous 30 j</th>
                <th className="px-4 py-2.5 text-right">Plus tard</th>
                <th className="px-4 py-2.5 text-right">Sans date</th>
                <th className="px-4 py-2.5 text-right">Total dû</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.sens}|${r.cpKey}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <Link href={`/finances/tresorerie?cp=${encodeURIComponent(`${sens}|${r.cpKey}`)}`} className="font-medium text-slate-900 hover:text-emerald-700">
                      {r.cpNom}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {contrepartieTypeLabels[r.cpType]} · {r.nbDossiers} dossier{r.nbDossiers > 1 ? "s" : ""}
                      {r.prochaineEcheance ? ` · prochaine échéance ${r.prochaineEcheance.toLocaleDateString("fr-FR")}` : ""}
                    </p>
                  </td>
                  <td className={`px-4 py-2.5 text-right ${r.enRetardCts > 0 ? "font-medium text-red-600" : "text-slate-400"}`}>{r.enRetardCts > 0 ? formatCents(r.enRetardCts) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.sous30jCts > 0 ? formatCents(r.sous30jCts) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.plusTardCts > 0 ? formatCents(r.plusTardCts) : "—"}</td>
                  <td className={`px-4 py-2.5 text-right ${r.sansDateCts > 0 ? "text-amber-700" : "text-slate-400"}`}>{r.sansDateCts > 0 ? formatCents(r.sansDateCts) : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{formatCents(r.resteCts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}

function toPointable(l: LigneTreso): LignePointable {
  return {
    id: l.id,
    dossierId: l.dossierId,
    dossierReference: l.dossierReference,
    clientLabel: l.clientLabel,
    categorieLabel: l.categorieLabel,
    resteCts: l.resteCts,
    echeance: l.echeance ? l.echeance.toISOString() : null,
    echeanceEstimee: l.echeanceEstimee,
    enRetard: l.enRetard,
    virtuelle: l.virtuelle,
    factureId: l.factureId,
  };
}

export default async function TresoreriePage({ searchParams }: { searchParams: Promise<{ vue?: string; cp?: string; type?: string }> }) {
  const ctx = await requireUserContext();
  if (isPartnerRole(ctx) || !hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY")) redirect("/");
  const voitSorties = hasPermission(ctx, "VIEW_INTERNAL_COSTS");
  const peutPointer = hasPermission(ctx, "MANAGE_FINANCES");

  const { vue: vueRaw, cp, type } = await searchParams;
  const vue: Vue = vueRaw === "echeancier" || vueRaw === "realise" ? vueRaw : "contreparties";

  const toutes = await getLignesTresorerie(ctx.organisationId);
  const lignes = voitSorties ? toutes : toutes.filter((l) => l.sens === "ENTREE");
  const filtrees = type ? lignes.filter((l) => l.cpType === type) : lignes;

  const entrees = filtrees.filter((l) => l.sens === "ENTREE");
  const sorties = filtrees.filter((l) => l.sens === "SORTIE");
  const somme = (ls: LigneTreso[]) => ls.reduce((s, l) => s + l.resteCts, 0);
  const aEncaisser = somme(entrees);
  const aDecaisser = somme(sorties);
  const retardEntrees = somme(entrees.filter((l) => l.enRetard));
  const retardSorties = somme(sorties.filter((l) => l.enRetard));

  const nav = (v: Vue, label: string) => (
    <Link
      href={`/finances/tresorerie?vue=${v}${type ? `&type=${type}` : ""}`}
      className={`rounded-full border px-3 py-1 text-sm ${vue === v && !cp ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
    >
      {label}
    </Link>
  );

  // --- Détail d'une contrepartie ---
  if (cp) {
    const [sens, ...rest] = cp.split("|");
    const cpKey = rest.join("|");
    const detail = lignes
      .filter((l) => l.sens === sens && l.cpKey === cpKey)
      .sort((a, b) => (a.echeance?.getTime() ?? Infinity) - (b.echeance?.getTime() ?? Infinity));
    const nom = detail[0]?.cpNom ?? "Contrepartie";
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
        <Link href="/finances/tresorerie" className="text-sm text-slate-500 hover:text-emerald-700">
          ← Pilotage trésorerie
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{nom}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sens === "ENTREE" ? "Doit nous verser" : "Nous devons lui verser"} {formatCents(somme(detail))} sur {detail.length} ligne{detail.length > 1 ? "s" : ""}
            {somme(detail.filter((l) => l.enRetard)) > 0 && <span className="text-red-600"> · dont {formatCents(somme(detail.filter((l) => l.enRetard)))} en retard</span>}
          </p>
        </div>
        {detail.length === 0 ? (
          <p className="text-sm text-slate-400">Plus rien en attente pour cette contrepartie.</p>
        ) : (
          <PointageForm sens={sens === "SORTIE" ? "SORTIE" : "ENTREE"} cpNom={nom} lignes={detail.map(toPointable)} peutPointer={peutPointer} />
        )}
      </div>
    );
  }

  const [realise, recents] = vue === "realise" ? await Promise.all([getRealiseParMois(ctx.organisationId, 6), getReglementsRecents(ctx.organisationId, 30)]) : [null, null];
  const colonnes = vue === "echeancier" ? echeancierMensuel(filtrees, 6) : null;
  const synthese = vue === "contreparties" ? syntheseParContrepartie(filtrees) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pilotage trésorerie</h1>
          <p className="mt-1 text-sm text-slate-500">Ce qui doit rentrer, ce qui doit sortir, qui doit quoi et quand.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/finances" className="text-sm text-slate-500 hover:text-emerald-700">
            Vue finances détaillée
          </Link>
          <a
            href={`/api/finances/tresorerie${type ? `?type=${type}` : ""}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="À encaisser" value={formatCents(aEncaisser)} sub={retardEntrees > 0 ? `dont ${formatCents(retardEntrees)} en retard` : "aucun retard"} tone="emerald" icon={ArrowDownLeft} />
        {voitSorties && <Kpi label="À décaisser" value={formatCents(aDecaisser)} sub={retardSorties > 0 ? `dont ${formatCents(retardSorties)} en retard` : "aucun retard"} tone="rose" icon={ArrowUpRight} />}
        {voitSorties && <Kpi label="Solde à venir" value={formatCents(aEncaisser - aDecaisser)} sub="encaissements − décaissements attendus" tone="slate" icon={Scale} />}
        <Kpi
          label="Sans échéance"
          value={formatCents(somme(filtrees.filter((l) => !l.echeance)))}
          sub="à dater (dépôt, fin de travaux...)"
          tone="amber"
          icon={AlertTriangle}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {nav("contreparties", "Par contrepartie")}
        {nav("echeancier", "Échéancier mensuel")}
        {nav("realise", "Encaissé / décaissé")}
        <span className="mx-2 h-5 w-px bg-slate-200" />
        <form className="flex items-center gap-2">
          <input type="hidden" name="vue" value={vue} />
          <select name="type" defaultValue={type ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">Toutes contreparties</option>
            {Array.from(new Set([...TYPES_ENTREE, ...(voitSorties ? TYPES_SORTIE : [])])).map((t) => (
              <option key={t} value={t}>
                {contrepartieTypeLabels[t]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white hover:bg-slate-800">
            Filtrer
          </button>
        </form>
      </div>

      {synthese && (
        <>
          <TableContreparties titre="Doit nous rentrer" sens="ENTREE" rows={synthese.filter((s) => s.sens === "ENTREE")} />
          {voitSorties && <TableContreparties titre="Doit sortir" sens="SORTIE" rows={synthese.filter((s) => s.sens === "SORTIE")} />}
          <p className="text-xs text-slate-500">
            Les montants « prévus d&apos;après le dossier » (aides saisies, coûts des postes de travaux) apparaissent tant qu&apos;aucun mouvement détaillé
            n&apos;existe. Échéances estimées : CEE = dépôt délégataire + délai de paiement du délégataire ; sous-traitant = fin de travaux + délai du
            sous-traitant ; solde client = fin de travaux. L&apos;ANAH reste « à dater ».
          </p>
        </>
      )}

      {colonnes && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left" />
                {colonnes.map((c) => (
                  <th key={c.key} className={`px-3 py-2.5 ${c.key === "retard" ? "text-red-600" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-right">
              <tr className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-left text-slate-600">Entrées</td>
                {colonnes.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-emerald-700">
                    {c.entreesCts ? formatCents(c.entreesCts) : "—"}
                  </td>
                ))}
              </tr>
              {voitSorties && (
                <tr className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-left text-slate-600">Sorties</td>
                  {colonnes.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-rose-700">
                      {c.sortiesCts ? formatCents(c.sortiesCts) : "—"}
                    </td>
                  ))}
                </tr>
              )}
              {voitSorties && (
                <tr className="border-t border-slate-100 font-medium">
                  <td className="px-4 py-2.5 text-left text-slate-900">Net</td>
                  {colonnes.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 ${c.netCts < 0 ? "text-red-600" : "text-slate-900"}`}>
                      {formatCents(c.netCts)}
                    </td>
                  ))}
                </tr>
              )}
              {voitSorties && (
                <tr className="border-t border-slate-100 bg-slate-50/60 font-semibold">
                  <td className="px-4 py-2.5 text-left text-slate-900">Cumul</td>
                  {colonnes.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 ${c.cumulCts < 0 ? "text-red-600" : "text-slate-900"}`}>
                      {c.key === "sans-date" ? "—" : formatCents(c.cumulCts)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Prévision de flux, pas un solde bancaire : ajoutez votre solde de compte actuel au cumul pour estimer la trésorerie disponible.
          </p>
        </Card>
      )}

      {realise && recents && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left" />
                  {realise.map((m) => (
                    <th key={m.key} className="px-3 py-2.5">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-right">
                <tr className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-left text-slate-600">Encaissé</td>
                  {realise.map((m) => (
                    <td key={m.key} className="px-3 py-2.5 text-emerald-700">
                      {m.encaisseCts ? formatCents(m.encaisseCts) : "—"}
                    </td>
                  ))}
                </tr>
                {voitSorties && (
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-2.5 text-left text-slate-600">Décaissé</td>
                    {realise.map((m) => (
                      <td key={m.key} className="px-3 py-2.5 text-rose-700">
                        {m.decaisseCts ? formatCents(m.decaisseCts) : "—"}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Derniers paiements pointés</h2>
            <Card className="overflow-x-auto">
              {recents.length === 0 ? (
                <p className="p-5 text-sm text-slate-400">Aucun paiement pointé pour l&apos;instant : ouvrez une contrepartie pour en enregistrer un.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {recents
                      .filter((r) => voitSorties || r.sens === "ENTREE")
                      .map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 first:border-0">
                          <td className="px-4 py-2 text-slate-500">{r.date.toLocaleDateString("fr-FR")}</td>
                          <td className="px-4 py-2 text-slate-700">{r.contrepartie ?? "—"}</td>
                          <td className="px-4 py-2">
                            <Link href={`/dossiers/${r.dossierId}#flux-financiers`} className="text-slate-900 hover:text-emerald-700">
                              {r.dossierReference}
                            </Link>
                            <span className="ml-2 text-xs text-slate-400">{r.categorieLabel}</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-400">{r.reference ?? ""}</td>
                          <td className={`px-4 py-2 text-right font-medium ${r.sens === "ENTREE" ? "text-emerald-700" : "text-rose-700"}`}>
                            {r.sens === "ENTREE" ? "+" : "−"}
                            {formatCents(r.montantCts)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
