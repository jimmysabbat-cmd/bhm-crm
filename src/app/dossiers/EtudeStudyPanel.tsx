"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, ShieldAlert, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCents } from "@/lib/money";
import { studyDataQualityLabels, scenarioRecommandationLabels, statutEligibiliteReglementaireLabels } from "@/lib/dossier-labels";
import { simulerEtudeDossier, enregistrerEtudeDossier, selectionnerScenarioEtude, appliquerScenarioEtude, reconnaitreEtudeObsolete } from "./etude-actions";
import type { RedactedStudyScenario, RedactedStudyResult } from "@/lib/etude/redact";

// ============================================================
// Bloc "ÉTUDE & SCÉNARIOS" (P8, section 32) - affiche la dernière étude
// enregistrée (si elle existe) et permet d'en lancer une nouvelle
// simulation en direct (non enregistrée tant que "Enregistrer" n'est pas
// cliqué - section 20). Les données de coûts/marge arrivent déjà filtrées
// par rôle depuis le serveur (RedactedStudyScenario) : ce composant ne fait
// AUCUN nouveau filtrage par permission, il se contente d'afficher "—"
// quand le champ vaut null.
// ============================================================

const DATA_QUALITY_COLOR: Record<string, "slate" | "blue" | "amber" | "emerald" | "red"> = {
  COMPLETE: "emerald",
  GOOD: "blue",
  PARTIAL: "amber",
  INSUFFICIENT: "red",
};

const RECOMMANDATION_COLOR: Record<string, "slate" | "blue" | "amber" | "emerald" | "red" | "violet"> = {
  RECOMMANDE: "emerald",
  INTERESSANT: "blue",
  A_CONFIRMER: "amber",
  RISQUE: "violet",
  NON_RECOMMANDE: "red",
  IMPOSSIBLE_A_EVALUER: "slate",
};

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR");
}

export type LatestEtudeProps = {
  id: string;
  version: number;
  mode: "SIMULATION" | "OFFICIEL";
  createdAt: string;
  dataQuality: "COMPLETE" | "GOOD" | "PARTIAL" | "INSUFFICIENT";
  missingFields: string[];
  scenarios: RedactedStudyScenario[];
  recommendedScenarioLabel: string;
  recommendedScenarioId: string | null;
  selectedScenarioId: string | null;
  obsolete: boolean;
};

export function EtudeStudyPanel({
  dossierId,
  peutSimuler,
  peutEnregistrer,
  peutAppliquer,
  latestEtude,
  historique,
}: {
  dossierId: string;
  peutSimuler: boolean;
  peutEnregistrer: boolean;
  peutAppliquer: boolean;
  latestEtude: LatestEtudeProps | null;
  historique: { id: string; version: number; mode: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [liveResult, setLiveResult] = useState<RedactedStudyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailOuvert, setDetailOuvert] = useState<string | null>(null);

  const affichage: {
    origine: "LIVE" | "ETUDE" | "AUCUN";
    dataQuality: string | null;
    missingFields: string[];
    scenarios: RedactedStudyScenario[];
    recommendedScenarioLabel: string | null;
    recommendedScenarioId: string | null;
  } = liveResult
    ? {
        origine: "LIVE",
        dataQuality: liveResult.context.dataQuality,
        missingFields: liveResult.context.missingFields,
        scenarios: liveResult.scenarios,
        recommendedScenarioLabel: liveResult.recommendedScenarioLabel,
        recommendedScenarioId: liveResult.recommendedScenarioId,
      }
    : latestEtude
      ? {
          origine: "ETUDE",
          dataQuality: latestEtude.dataQuality,
          missingFields: latestEtude.missingFields,
          scenarios: latestEtude.scenarios,
          recommendedScenarioLabel: latestEtude.recommendedScenarioLabel,
          recommendedScenarioId: latestEtude.recommendedScenarioId,
        }
      : { origine: "AUCUN", dataQuality: null, missingFields: [], scenarios: [], recommendedScenarioLabel: null, recommendedScenarioId: null };

  function handleSimuler() {
    setError(null);
    startTransition(async () => {
      const r = await simulerEtudeDossier(dossierId);
      if (r.ok) setLiveResult(r.result);
      else setError(r.error);
    });
  }

  function handleEnregistrer(mode: "SIMULATION" | "OFFICIEL") {
    setError(null);
    startTransition(async () => {
      const r = await enregistrerEtudeDossier(dossierId, mode);
      if (r.ok) {
        setLiveResult(null);
        router.refresh();
      } else setError(r.error);
    });
  }

  function handleSelectionner(scenarioId: string) {
    if (!latestEtude) return;
    setError(null);
    startTransition(async () => {
      const r = await selectionnerScenarioEtude(latestEtude.id, scenarioId);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function handleAppliquer(scenarioId: string) {
    if (!latestEtude) return;
    setError(null);
    startTransition(async () => {
      const r = await appliquerScenarioEtude(latestEtude.id, scenarioId);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function handleReconnaitreObsolete() {
    if (!latestEtude) return;
    setError(null);
    startTransition(async () => {
      const r = await reconnaitreEtudeObsolete(latestEtude.id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-emerald-600" />
          <CardTitle>Étude &amp; scénarios</CardTitle>
          {affichage.dataQuality && (
            <Badge color={DATA_QUALITY_COLOR[affichage.dataQuality] ?? "slate"}>
              {studyDataQualityLabels[affichage.dataQuality as keyof typeof studyDataQualityLabels]}
            </Badge>
          )}
          {liveResult && <Badge color="violet">Simulation non enregistrée</Badge>}
        </div>
        {peutSimuler && (
          <Button type="button" variant="secondary" className="text-xs" onClick={handleSimuler} disabled={isPending}>
            <RefreshCw className="h-3.5 w-3.5" />
            Simuler
          </Button>
        )}
      </CardHeader>

      <div className="space-y-4 p-5">
        {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}

        {latestEtude?.obsolete && !liveResult && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>
              Étude v{latestEtude.version} ({latestEtude.mode}) obsolète : des données du dossier ont changé depuis son enregistrement.
            </span>
            <div className="ml-auto flex gap-2">
              {peutSimuler && (
                <Button type="button" variant="secondary" className="text-xs" onClick={handleSimuler} disabled={isPending}>
                  Recalculer
                </Button>
              )}
              <Button type="button" variant="ghost" className="text-xs" onClick={handleReconnaitreObsolete} disabled={isPending}>
                Marquer comme vue
              </Button>
            </div>
          </div>
        )}

        {affichage.origine === "AUCUN" && (
          <p className="text-sm text-slate-500">
            Aucune étude enregistrée pour ce dossier.{" "}
            {peutSimuler ? "Cliquez sur « Simuler » pour générer une première étude à partir des données actuelles." : "Aucune étude n'a encore été simulée."}
          </p>
        )}

        {affichage.missingFields.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p className="mb-1 font-medium text-slate-700">Données manquantes pour affiner l&apos;étude ({affichage.missingFields.length})</p>
            <p className="text-slate-500">{affichage.missingFields.join(", ")}</p>
          </div>
        )}

        {affichage.scenarios.length > 0 && (
          <>
            <p className="text-xs italic text-slate-400">{affichage.recommendedScenarioLabel}</p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-slate-400">
                  <tr>
                    <th className="py-1 pr-3">Scénario</th>
                    <th className="py-1 pr-3">Éligibilité</th>
                    <th className="py-1 pr-3 text-right">CEE (kWh cumac)</th>
                    <th className="py-1 pr-3 text-right">Reste à charge</th>
                    <th className="py-1 pr-3 text-right">Marge</th>
                    <th className="py-1 pr-3 text-right">Score</th>
                    <th className="py-1 pr-3">Recommandation</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {affichage.scenarios.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-3">
                        {s.titre}
                        {s.id === affichage.recommendedScenarioId && <span className="ml-1 text-emerald-600">★</span>}
                        {latestEtude?.selectedScenarioId === s.id && <Badge color="blue">Sélectionné</Badge>}
                      </td>
                      <td className="py-1.5 pr-3">{s.statutEligibilite ? statutEligibiliteReglementaireLabels[s.statutEligibilite] : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{s.ceeKwhCumac != null ? s.ceeKwhCumac.toLocaleString("fr-FR") : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{s.resteAChargeClientCts != null ? formatCents(s.resteAChargeClientCts) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {s.margin === null ? "Non visible" : s.margin.confidence === "NON_CALCULABLE" ? "Non calculable" : `${formatCents(s.margin.margeCts)}${s.margin.margePct != null ? ` (${s.margin.margePct.toFixed(0)} %)` : ""}`}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{s.score.score}</td>
                      <td className="py-1.5 pr-3">
                        <Badge color={RECOMMANDATION_COLOR[s.recommandation]}>{scenarioRecommandationLabels[s.recommandation]}</Badge>
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="text-xs font-medium text-emerald-700 hover:underline"
                          onClick={() => setDetailOuvert(detailOuvert === s.id ? null : s.id)}
                        >
                          {detailOuvert === s.id ? "Masquer" : "Voir détail"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {affichage.scenarios
              .filter((s) => s.id === detailOuvert)
              .map((s) => (
                <ScenarioDetail
                  key={s.id}
                  scenario={s}
                  peutSelectionner={peutEnregistrer && latestEtude !== null && affichage.origine === "ETUDE"}
                  peutAppliquer={peutAppliquer && latestEtude !== null && affichage.origine === "ETUDE"}
                  isPending={isPending}
                  onSelectionner={() => handleSelectionner(s.id)}
                  onAppliquer={() => handleAppliquer(s.id)}
                />
              ))}
          </>
        )}

        {peutEnregistrer && affichage.scenarios.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Button type="button" variant="secondary" className="text-xs" onClick={() => handleEnregistrer("SIMULATION")} disabled={isPending}>
              Enregistrer (simulation)
            </Button>
            <Button type="button" className="text-xs" onClick={() => handleEnregistrer("OFFICIEL")} disabled={isPending}>
              Enregistrer officiel
            </Button>
          </div>
        )}

        {historique.length > 0 && (
          <details className="border-t border-slate-100 pt-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-500">Historique des études ({historique.length})</summary>
            <ul className="mt-2 space-y-1 text-slate-500">
              {historique.map((h) => (
                <li key={h.id}>
                  v{h.version} · {h.mode} · {formatDate(h.createdAt)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function ScenarioDetail({
  scenario,
  peutSelectionner,
  peutAppliquer,
  isPending,
  onSelectionner,
  onAppliquer,
}: {
  scenario: RedactedStudyScenario;
  peutSelectionner: boolean;
  peutAppliquer: boolean;
  isPending: boolean;
  onSelectionner: () => void;
  onAppliquer: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-xs">
      <p className="text-sm font-medium text-slate-800">{scenario.titre}</p>
      <p className="text-slate-500">{scenario.description}</p>

      {scenario.fichesReglementaires.map((f) => (
        <div key={f.ruleVersionId} className="rounded-lg bg-white p-2.5">
          <p>
            <strong>{f.ficheCode}</strong> v{f.numeroVersion} — source : {f.sourceNom}
          </p>
          {f.confianceSource === "UNVERIFIED_SOURCE" && (
            <p className="mt-1 flex items-center gap-1 font-medium text-amber-700">
              <ShieldAlert className="h-3 w-3" /> Source non vérifiée{f.avertissementSource ? ` — ${f.avertissementSource}` : ""}
            </p>
          )}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <p>
          <span className="text-slate-400">CA contractuel : </span>
          {formatCents(scenario.caContractuelCts)}
        </p>
        <p>
          <span className="text-slate-400">Reste à charge client : </span>
          {scenario.resteAChargeClientCts != null ? formatCents(scenario.resteAChargeClientCts) : "Non déterminable"}
        </p>
        <p>
          <span className="text-slate-400">Coûts prévus : </span>
          {scenario.coutsPrevusCts != null ? formatCents(scenario.coutsPrevusCts) : "Non visible pour votre rôle"}
        </p>
        <p>
          <span className="text-slate-400">Marge : </span>
          {scenario.margin === null
            ? "Non visible pour votre rôle"
            : scenario.margin.confidence === "NON_CALCULABLE"
              ? "Non calculable"
              : `${formatCents(scenario.margin.margeCts)}${scenario.margin.margePct != null ? ` (${scenario.margin.margePct.toFixed(0)} %)` : ""} — ${scenario.margin.confidence === "ESTIMATION_INCOMPLETE" ? "estimation incomplète" : "fiable"}`}
        </p>
        <p>
          <span className="text-slate-400">Besoin de trésorerie : </span>
          {scenario.cashRequirement.montantAAvancerCts != null ? formatCents(scenario.cashRequirement.montantAAvancerCts) : "Non estimable"}
        </p>
        <p>
          <span className="text-slate-400">Délai d&apos;encaissement : </span>
          {scenario.delaiEncaissement.estimable ? `${scenario.delaiEncaissement.joursEstimes} j (${formatDate(scenario.delaiEncaissement.dateEstimee)})` : "Non estimable"}
        </p>
      </div>

      {scenario.aides.length > 0 && (
        <div>
          <p className="font-medium text-slate-600">Aides</p>
          <ul className="text-slate-500">
            {scenario.aides.map((a) => (
              <li key={a.origine}>
                {a.origine} : {formatCents(a.montantCts)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scenario.risques.length > 0 && (
        <div>
          <p className="font-medium text-amber-700">Risques</p>
          <ul className="text-amber-700">
            {scenario.risques.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}

      {scenario.warnings.length > 0 && (
        <ul className="text-slate-500">
          {scenario.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div>
        <p className="font-medium text-slate-600">Score : {scenario.score.score}</p>
        <ul className="text-slate-500">
          {scenario.score.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="font-medium text-slate-600">Pourquoi cette recommandation ({scenarioRecommandationLabels[scenario.recommandation]})</p>
        <ul className="text-slate-500">
          {scenario.recommandationReasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </div>

      {(peutSelectionner || peutAppliquer) && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
          {peutSelectionner && (
            <Button type="button" variant="secondary" className="text-xs" onClick={onSelectionner} disabled={isPending}>
              Sélectionner ce scénario
            </Button>
          )}
          {peutAppliquer && (
            <Button type="button" className="text-xs" onClick={onAppliquer} disabled={isPending}>
              Appliquer au dossier
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
