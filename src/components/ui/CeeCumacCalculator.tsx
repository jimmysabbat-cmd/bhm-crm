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

export type DelegataireRachat = {
  id: string;
  nom: string;
  rachatTresModesteCts: number | null;
  rachatClassiqueCts: number | null;
};

const AUTRE = "autre";

export function CeeCumacCalculator({
  cumacTargetId,
  primeTargetId,
  defaultZone,
  delegataires,
  defaultDelegataireOptionKey,
}: {
  cumacTargetId: string;
  primeTargetId: string;
  defaultZone?: ZoneClimatique | null;
  delegataires: DelegataireRachat[];
  /** Pré-sélectionne une option, ex. "delId:tm" ou "delId:classique" — le délégataire du dossier si connu. */
  defaultDelegataireOptionKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<ZoneClimatique>(defaultZone ?? "H1");
  const [surface, setSurface] = useState("");
  const [etas, setEtas] = useState<Etas>("plus140");
  const [tauxOption, setTauxOption] = useState<string>(defaultDelegataireOptionKey ?? AUTRE);
  const [rachatManuel, setRachatManuel] = useState("");

  const options: { key: string; label: string; valeur: number }[] = [];
  for (const d of delegataires) {
    if (d.rachatTresModesteCts !== null) {
      options.push({
        key: `${d.id}:tm`,
        label: `${d.nom} — Très modeste (${(d.rachatTresModesteCts / 100).toFixed(2)} €/MCumac)`,
        valeur: d.rachatTresModesteCts / 100,
      });
    }
    if (d.rachatClassiqueCts !== null) {
      options.push({
        key: `${d.id}:classique`,
        label: `${d.nom} — Modeste/Classique (${(d.rachatClassiqueCts / 100).toFixed(2)} €/MCumac)`,
        valeur: d.rachatClassiqueCts / 100,
      });
    }
  }

  const surfaceNum = Number(surface) || 0;
  const cumac = surfaceNum > 0 ? CUMAC[zone][surfaceTranche(surfaceNum)][etas] : null;
  const rachat =
    tauxOption === AUTRE ? Number(rachatManuel) || 0 : options.find((o) => o.key === tauxOption)?.valeur ?? 0;
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
          <select value={tauxOption} onChange={(e) => setTauxOption(e.target.value)} className={inputClass}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            <option value={AUTRE}>Autre délégataire (saisie libre)</option>
          </select>
        </div>
      </div>

      {tauxOption === AUTRE && (
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
