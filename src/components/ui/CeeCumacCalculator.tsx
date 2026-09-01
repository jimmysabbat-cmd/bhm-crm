"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import type { ZoneClimatique } from "@/generated/prisma/enums";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

// Fiche CEE BAR-TH-171 (PAC air/eau) — barème de valorisation transmis par
// l'utilisateur (tableau "Eco Environnement - Eco Negoce", entrée en
// vigueur le 01/01/2026). Cumac (kWhc) par zone climatique, tranche de
// surface chauffée et bande d'ETAS. Rien en dessous de 111% d'ETAS n'est
// couvert par ce barème.
type SurfaceTranche = "moins70" | "70a90" | "plus90";
type Etas = "111a140" | "plus140";

const CUMAC: Record<ZoneClimatique, Record<SurfaceTranche, Record<Etas, number>>> = {
  H1: {
    moins70: { "111a140": 272_700, plus140: 327_600 },
    "70a90": { "111a140": 381_780, plus140: 458_640 },
    plus90: { "111a140": 545_400, plus140: 655_200 },
  },
  H2: {
    moins70: { "111a140": 227_250, plus140: 273_000 },
    "70a90": { "111a140": 318_150, plus140: 382_200 },
    plus90: { "111a140": 454_500, plus140: 546_000 },
  },
  H3: {
    moins70: { "111a140": 159_075, plus140: 191_100 },
    "70a90": { "111a140": 222_705, plus140: 267_540 },
    plus90: { "111a140": 318_150, plus140: 382_200 },
  },
};

function surfaceTranche(surfaceM2: number): SurfaceTranche {
  if (surfaceM2 < 70) return "moins70";
  if (surfaceM2 < 90) return "70a90";
  return "plus90";
}

// Taux de rachat connus (partenaire Eco Environnement, en vigueur au
// 01/01/2026) proposés en raccourci ; "Autre" laisse saisir librement pour
// tout autre délégataire (ex. Watt Energy à 13,5 €/MCumac vu ailleurs).
const TAUX_CONNUS = {
  eco_precarite: { label: "Eco Environnement — Très modeste (12,50 €/MCumac)", valeur: 12.5 },
  eco_classique: { label: "Eco Environnement — Modeste / Classique (7,40 €/MCumac)", valeur: 7.4 },
  autre: { label: "Autre délégataire (saisie libre)", valeur: null },
} as const;
type TauxKey = keyof typeof TAUX_CONNUS;

export function CeeCumacCalculator({
  cumacTargetId,
  primeTargetId,
  defaultZone,
}: {
  cumacTargetId: string;
  primeTargetId: string;
  defaultZone?: ZoneClimatique | null;
}) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<ZoneClimatique>(defaultZone ?? "H1");
  const [surface, setSurface] = useState("");
  const [etas, setEtas] = useState<Etas>("plus140");
  const [tauxKey, setTauxKey] = useState<TauxKey>("eco_precarite");
  const [rachatManuel, setRachatManuel] = useState("");

  const surfaceNum = Number(surface) || 0;
  const cumac = surfaceNum > 0 ? CUMAC[zone][surfaceTranche(surfaceNum)][etas] : null;
  const rachat = tauxKey === "autre" ? Number(rachatManuel) || 0 : TAUX_CONNUS[tauxKey].valeur ?? 0;
  const primeCts = cumac !== null ? Math.round((cumac * rachat) / 10) : null;

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
        Calculer le CEE (PAC air/eau — fiche BAR-TH-171)
      </button>
    );
  }

  return (
    <div className="col-span-2 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 sm:col-span-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Calculator className="h-3.5 w-3.5" />
          Calculateur CEE — PAC air/eau (BAR-TH-171)
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Fermer
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className={labelClass}>Zone climatique</label>
          <select value={zone} onChange={(e) => setZone(e.target.value as ZoneClimatique)} className={inputClass}>
            <option value="H1">H1</option>
            <option value="H2">H2</option>
            <option value="H3">H3</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Surface chauffée (m²)</label>
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
          <select value={etas} onChange={(e) => setEtas(e.target.value as Etas)} className={inputClass}>
            <option value="111a140">111 % ≤ ETAS &lt; 140 %</option>
            <option value="plus140">ETAS ≥ 140 %</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Taux de rachat</label>
          <select value={tauxKey} onChange={(e) => setTauxKey(e.target.value as TauxKey)} className={inputClass}>
            {Object.entries(TAUX_CONNUS).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tauxKey === "autre" && (
        <div className="w-48 space-y-1">
          <label className={labelClass}>Rachat délégataire (€/MCumac)</label>
          <input
            type="number"
            step="0.01"
            value={rachatManuel}
            onChange={(e) => setRachatManuel(e.target.value)}
            placeholder="ex. 13,5"
            className={inputClass}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
        {cumac === null ? (
          <span className="text-amber-600">Renseigne la surface pour calculer le cumac.</span>
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
