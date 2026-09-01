"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import type { Precarite } from "@/generated/prisma/enums";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

// Barème officiel ANAH — MaPrimeRénov' rénovation d'ampleur, maison individuelle,
// propriétaires occupants (guide ANAH "Les aides financières en 2026", p.22).
// Le taux ne dépend que de la catégorie de revenu ; seul le plafond de dépenses
// éligibles HT change selon le gain de classes (2, ou 3 et plus).
const PLAFOND_HT_CTS: Record<"2" | "3plus", number> = {
  "2": 30_000_00,
  "3plus": 40_000_00,
};

const TAUX: Record<Precarite, number> = {
  TRES_MODESTE: 0.8,
  MODESTE: 0.6,
  INTERMEDIAIRE: 0.45,
  SUPERIEUR: 0.1,
};

const precariteOptions: { value: Precarite; label: string }[] = [
  { value: "TRES_MODESTE", label: "Très modeste" },
  { value: "MODESTE", label: "Modeste" },
  { value: "INTERMEDIAIRE", label: "Intermédiaire" },
  { value: "SUPERIEUR", label: "Supérieur" },
];

export function MprAmpleurCalculator({
  targetInputId,
  defaultPrecarite,
}: {
  targetInputId: string;
  defaultPrecarite?: Precarite | null;
}) {
  const [open, setOpen] = useState(false);
  const [montantHT, setMontantHT] = useState("");
  const [gain, setGain] = useState<"2" | "3plus">("3plus");
  const [precarite, setPrecarite] = useState<Precarite>(defaultPrecarite ?? "TRES_MODESTE");

  const htCts = Math.round((Number(montantHT) || 0) * 100);
  const baseCts = Math.min(htCts, PLAFOND_HT_CTS[gain]);
  const aideCts = Math.round(baseCts * TAUX[precarite]);

  function apply() {
    const el = document.getElementById(targetInputId) as HTMLInputElement | null;
    if (!el) return;
    el.value = (aideCts / 100).toFixed(2);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
      >
        <Calculator className="h-3.5 w-3.5" />
        Calculer l&apos;aide MPR (rénovation d&apos;ampleur)
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Calculator className="h-3.5 w-3.5" />
          Calculateur aide MPR — rénovation d&apos;ampleur
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
          <label className={labelClass}>Montant HT travaux éligibles (€)</label>
          <input
            type="number"
            step="0.01"
            value={montantHT}
            onChange={(e) => setMontantHT(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Gain énergétique</label>
          <select
            value={gain}
            onChange={(e) => setGain(e.target.value as "2" | "3plus")}
            className={inputClass}
          >
            <option value="2">2 classes (plafond 30 000 €)</option>
            <option value="3plus">3 classes ou plus (plafond 40 000 €)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Catégorie de revenu</label>
          <select
            value={precarite}
            onChange={(e) => setPrecarite(e.target.value as Precarite)}
            className={inputClass}
          >
            {precariteOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
        <span className="text-slate-500">
          {Math.round(TAUX[precarite] * 100)}% × min(HT, plafond {formatCents(PLAFOND_HT_CTS[gain])})
        </span>
        <span className="text-lg font-semibold text-emerald-700">{formatCents(aideCts)}</span>
      </div>

      <Button type="button" variant="secondary" className="text-xs" onClick={apply}>
        Utiliser ce montant
      </Button>
    </div>
  );
}
