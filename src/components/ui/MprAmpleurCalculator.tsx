"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import type { Precarite } from "@/generated/prisma/enums";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

// Le barème ANAH MaPrimeRénov' rénovation d'ampleur a changé entre le guide
// "Les aides financières en 2025" (édition mars 2025) et celui "en 2026"
// (édition septembre 2026). Le nouveau barème s'applique depuis le 1er
// septembre 2025 (date donnée par l'utilisateur — à corriger si besoin).
const CUTOFF_NOUVEAU_BAREME = "2025-09-01";

type Gain = "2" | "3" | "4plus";

// Ancien barème (dossiers déposés avant le 01/09/2025) — guide ANAH mars 2025, p.24
const ANCIEN_PLAFOND_HT_CTS: Record<Gain, number> = {
  "2": 40_000_00,
  "3": 55_000_00,
  "4plus": 70_000_00,
};
const ANCIEN_TAUX: Record<Precarite, Record<Gain, number>> = {
  TRES_MODESTE: { "2": 0.8, "3": 0.8, "4plus": 0.8 },
  MODESTE: { "2": 0.6, "3": 0.6, "4plus": 0.6 },
  INTERMEDIAIRE: { "2": 0.45, "3": 0.5, "4plus": 0.5 },
  SUPERIEUR: { "2": 0.1, "3": 0.15, "4plus": 0.2 },
};
const BONIFICATION_PASSOIRE = 0.1;

// Nouveau barème (dossiers déposés depuis le 01/09/2025) — guide ANAH sept. 2026, p.22
// Même taux pour 3 classes et 4 classes ou plus (plafond commun à 40 000 €).
const NOUVEAU_PLAFOND_HT_CTS: Record<Gain, number> = {
  "2": 30_000_00,
  "3": 40_000_00,
  "4plus": 40_000_00,
};
const NOUVEAU_TAUX: Record<Precarite, number> = {
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

const gainOptions: { value: Gain; label: string }[] = [
  { value: "2", label: "2 classes gagnées" },
  { value: "3", label: "3 classes gagnées" },
  { value: "4plus", label: "4 classes gagnées ou plus" },
];

export function MprAmpleurCalculator({
  targetInputId,
  defaultPrecarite,
  defaultDateDepot,
}: {
  targetInputId: string;
  defaultPrecarite?: Precarite | null;
  /** Date de dépôt du dossier ANAH au format "yyyy-mm-dd", pour choisir le bon barème. */
  defaultDateDepot?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [montantHT, setMontantHT] = useState("");
  const [gain, setGain] = useState<Gain>("3");
  const [precarite, setPrecarite] = useState<Precarite>(defaultPrecarite ?? "TRES_MODESTE");
  const [dateDepot, setDateDepot] = useState(defaultDateDepot ?? "");
  const [passoire, setPassoire] = useState(false);

  const ancienBareme = dateDepot !== "" && dateDepot < CUTOFF_NOUVEAU_BAREME;

  const htCts = Math.round((Number(montantHT) || 0) * 100);
  const plafondCts = ancienBareme ? ANCIEN_PLAFOND_HT_CTS[gain] : NOUVEAU_PLAFOND_HT_CTS[gain];
  const tauxBase = ancienBareme ? ANCIEN_TAUX[precarite][gain] : NOUVEAU_TAUX[precarite];
  const taux = ancienBareme && passoire ? Math.min(tauxBase + BONIFICATION_PASSOIRE, 1) : tauxBase;
  const baseCts = Math.min(htCts, plafondCts);
  const aideCts = Math.round(baseCts * taux);

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className={labelClass}>Date de dépôt du dossier ANAH</label>
          <input
            type="date"
            value={dateDepot}
            onChange={(e) => setDateDepot(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-end pb-2 text-xs text-slate-500">
          Barème appliqué :{" "}
          <span className={`ml-1 font-medium ${ancienBareme ? "text-amber-700" : "text-emerald-700"}`}>
            {ancienBareme ? "ancien (avant 09/2025)" : "actuel (depuis 09/2025)"}
          </span>
        </div>
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
          <select value={gain} onChange={(e) => setGain(e.target.value as Gain)} className={inputClass}>
            {gainOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
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

      {ancienBareme && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={passoire}
            onChange={(e) => setPassoire(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Bonification &laquo;&nbsp;sortie de passoire énergétique&nbsp;&raquo; (+10 pts — logement F/G
          atteignant au moins D)
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
        <span className="text-slate-500">
          {Math.round(taux * 100)}% × min(HT, plafond {formatCents(plafondCts)})
        </span>
        <span className="text-lg font-semibold text-emerald-700">{formatCents(aideCts)}</span>
      </div>

      <Button type="button" variant="secondary" className="text-xs" onClick={apply}>
        Utiliser ce montant
      </Button>
    </div>
  );
}
