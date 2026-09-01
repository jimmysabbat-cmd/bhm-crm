"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

// Fiche CEE PAC air/eau — données transmises par l'utilisateur, valables
// "à l'heure actuelle". Seule la tranche >= 90 m² est connue pour l'instant ;
// d'autres tranches de surface seront ajoutées si l'utilisateur les fournit.
function cumacPacAirEau(surfaceM2: number, etasSup140: boolean): number | null {
  if (surfaceM2 < 90) return null;
  return etasSup140 ? 655_200 : 545_400;
}

export function CeeCumacCalculator({
  cumacTargetId,
  primeTargetId,
}: {
  cumacTargetId: string;
  primeTargetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState("");
  const [etasSup140, setEtasSup140] = useState(true);
  const [rachat, setRachat] = useState("");

  const cumac = cumacPacAirEau(Number(surface) || 0, etasSup140);
  const primeCts = cumac !== null ? Math.round((cumac * (Number(rachat) || 0)) / 10) : null;

  function apply() {
    if (cumac === null || primeCts === null) return;
    const cumacEl = document.getElementById(cumacTargetId) as HTMLInputElement | null;
    const primeEl = document.getElementById(primeTargetId) as HTMLInputElement | null;
    if (cumacEl) {
      cumacEl.value = String(cumac);
      cumacEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (primeEl) {
      primeEl.value = (primeCts / 100).toFixed(2);
      primeEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
      >
        <Calculator className="h-3.5 w-3.5" />
        Calculer le CEE (PAC air/eau)
      </button>
    );
  }

  return (
    <div className="col-span-2 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 sm:col-span-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Calculator className="h-3.5 w-3.5" />
          Calculateur CEE — PAC air/eau
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Fermer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className={labelClass}>Surface (m²)</label>
          <input
            type="number"
            step="0.01"
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>ETAS</label>
          <select
            value={etasSup140 ? "sup" : "inf"}
            onChange={(e) => setEtasSup140(e.target.value === "sup")}
            className={inputClass}
          >
            <option value="sup">Supérieur à 140 %</option>
            <option value="inf">Inférieur à 140 %</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Rachat délégataire (€/MCumac)</label>
          <input
            type="number"
            step="0.01"
            value={rachat}
            onChange={(e) => setRachat(e.target.value)}
            placeholder="ex. 13,5"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
        {cumac === null ? (
          <span className="text-amber-600">
            Pas de donnée pour une surface &lt; 90 m² — renseigne le CUMAC manuellement.
          </span>
        ) : (
          <>
            <span className="text-slate-500">
              {cumac.toLocaleString("fr-FR")} kWh cumac × {rachat || "?"} €/MCumac
            </span>
            <span className="text-lg font-semibold text-emerald-700">
              {primeCts !== null ? formatCents(primeCts) : "—"}
            </span>
          </>
        )}
      </div>

      <Button type="button" variant="secondary" className="text-xs" onClick={apply} disabled={cumac === null}>
        Utiliser ces valeurs
      </Button>
    </div>
  );
}
