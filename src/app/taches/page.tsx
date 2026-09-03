import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCcw } from "lucide-react";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { getNextBestActions, estAujourdhui, estCetteSemaine, roleLabels } from "@/lib/next-best-action";
import { evaluateRelanceRules } from "@/lib/relances";
import { formatCents } from "@/lib/money";
import { toggleTache, deleteTache } from "../dossiers/actions";
import { demarrerEtape, terminerEtape, debloquerEtape } from "../dossiers/workflow-actions";
import { marquerMouvementRecu, marquerMouvementPaye } from "../dossiers/mouvement-actions";
import { marquerRelanceFaite } from "./actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";

const FILTRES = ["aujourdhui", "retard", "semaine", "toutes"] as const;
type Filtre = (typeof FILTRES)[number];

const FILTRE_LABELS: Record<Filtre, string> = {
  aujourdhui: "Aujourd'hui",
  retard: "En retard",
  semaine: "Cette semaine",
  toutes: "Toutes",
};

const NIVEAU_COLOR: Record<string, "slate" | "blue" | "amber" | "red"> = {
  BASSE: "slate",
  NORMALE: "blue",
  HAUTE: "amber",
  CRITIQUE: "red",
};

export default async function TachesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string; vue?: string }>;
}) {
  const { filtre: filtreRaw, vue } = await searchParams;
  const filtre: Filtre = FILTRES.includes(filtreRaw as Filtre) ? (filtreRaw as Filtre) : "aujourdhui";

  const ctx = await requireUserContext();
  const peutVoirTout = hasPermission(ctx, "VIEW_ALL_ACTIONS");
  const scope = peutVoirTout && vue === "tout" ? "all" : "mine";

  // Idempotent - sûr à appeler à chaque ouverture de cette page (pas de cron
  // dans cette V1, cf. section 11 du prompt).
  await evaluateRelanceRules(ctx.organisationId);

  const toutesLesActions = await getNextBestActions({
    organisationId: ctx.organisationId,
    scope,
    userId: ctx.userId,
    role: ctx.role,
  });

  const actions = toutesLesActions.filter((a) => {
    if (filtre === "retard") return a.joursRetard > 0;
    if (filtre === "semaine") return estCetteSemaine(a);
    if (filtre === "toutes") return true;
    return estAujourdhui(a);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Mes actions</h1>
          <p className="mt-1 text-sm text-slate-500">
            {actions.length} action{actions.length > 1 ? "s" : ""} — priorité décroissante, puis échéance
          </p>
        </div>
        <div className="flex items-center gap-3">
          {peutVoirTout && (
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
              <Link
                href={`/taches?filtre=${filtre}`}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  scope === "mine" ? "bg-emerald-50 text-emerald-700" : "text-slate-500"
                }`}
              >
                Mes actions
              </Link>
              <Link
                href={`/taches?filtre=${filtre}&vue=tout`}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  scope === "all" ? "bg-emerald-50 text-emerald-700" : "text-slate-500"
                }`}
              >
                Toute l&apos;équipe
              </Link>
            </div>
          )}
          <form action={async () => { "use server"; await evaluateRelanceRules(ctx.organisationId); }}>
            <Button type="submit" variant="ghost" className="text-xs">
              <RefreshCcw className="h-3.5 w-3.5" />
              Recalculer les relances
            </Button>
          </form>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {FILTRES.map((f) => (
          <Link
            key={f}
            href={`/taches?filtre=${f}${scope === "all" ? "&vue=tout" : ""}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center font-medium transition ${
              filtre === f ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {FILTRE_LABELS[f]}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Priorité</th>
              <th className="px-4 py-3">Client / dossier</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Flux</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3">Montant bloqué</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/70 align-top">
                <td className="px-4 py-3">
                  <Badge color={NIVEAU_COLOR[a.niveauUrgence]}>{a.niveauUrgence}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Link href={a.route} className="font-medium text-slate-900 hover:text-emerald-700">
                    {a.client}
                  </Link>
                  <p className="text-xs text-slate-400">{a.referenceDossier}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{a.titre}</p>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-slate-400">
                    {a.reasons.map((r) => (
                      <li key={r}>· {r}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 text-slate-500">{a.flux ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{a.responsableLabel}</td>
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
                <td className="px-4 py-3 font-medium text-slate-900">
                  {a.montantBloqueCts > 0 ? formatCents(a.montantBloqueCts) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2 text-xs">
                    {a.typeAction === "TACHE" && (
                      <>
                        <form action={async () => { "use server"; await toggleTache(a.sourceId, true); }}>
                          <button type="submit" className="font-medium text-emerald-700 hover:text-emerald-800">
                            Fait
                          </button>
                        </form>
                        <form action={async () => { "use server"; await deleteTache(a.sourceId, a.dossierId); }}>
                          <ConfirmSubmitButton
                            label="Supprimer"
                            confirmMessage="Supprimer cette tâche ?"
                            className="font-medium text-slate-400 hover:text-red-600"
                          />
                        </form>
                      </>
                    )}
                    {a.typeAction === "ETAPE" && (
                      <>
                        {a.statut === "A_FAIRE" && (
                          <form action={async () => { "use server"; await demarrerEtape(a.sourceId); }}>
                            <button type="submit" className="font-medium text-slate-600 hover:text-slate-900">
                              Démarrer
                            </button>
                          </form>
                        )}
                        {(a.statut === "A_FAIRE" || a.statut === "EN_COURS") && (
                          <form action={async () => { "use server"; await terminerEtape(a.sourceId); }}>
                            <button type="submit" className="font-medium text-emerald-700 hover:text-emerald-800">
                              Terminer
                            </button>
                          </form>
                        )}
                        {a.statut === "BLOQUE" && (
                          <form action={async () => { "use server"; await debloquerEtape(a.sourceId); }}>
                            <button type="submit" className="font-medium text-slate-600 hover:text-slate-900">
                              Débloquer
                            </button>
                          </form>
                        )}
                      </>
                    )}
                    {a.typeAction === "MOUVEMENT_FINANCIER" && a.mouvementType === "ENTREE" && (
                      <form action={async () => { "use server"; await marquerMouvementRecu(a.sourceId); }}>
                        <button type="submit" className="font-medium text-emerald-700 hover:text-emerald-800">
                          Marquer reçu
                        </button>
                      </form>
                    )}
                    {a.typeAction === "MOUVEMENT_FINANCIER" && a.mouvementType === "SORTIE" && (
                      <form action={async () => { "use server"; await marquerMouvementPaye(a.sourceId); }}>
                        <button type="submit" className="font-medium text-emerald-700 hover:text-emerald-800">
                          Marquer payé
                        </button>
                      </form>
                    )}
                    {a.tacheRelanceId && (
                      <form action={async () => { "use server"; await marquerRelanceFaite(a.tacheRelanceId as string); }}>
                        <button type="submit" className="font-medium text-slate-600 hover:text-slate-900">
                          Relance faite
                        </button>
                      </form>
                    )}
                    <Link
                      href={a.route}
                      className="flex items-center gap-0.5 font-medium text-slate-400 hover:text-slate-700"
                    >
                      Ouvrir <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {actions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  Aucune action {FILTRE_LABELS[filtre].toLowerCase()}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-slate-400">
        Rôle : {roleLabels[ctx.role] ?? ctx.role}
        {peutVoirTout && ` · vue actuelle : ${scope === "all" ? "toute l'équipe" : "mes actions"}`}
      </p>
    </div>
  );
}
