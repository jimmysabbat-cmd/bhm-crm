"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";

export type SousTraitantAvecTarifs = {
  id: string;
  nom: string;
  tarifM2CtsIdf: number | null;
  tarifM2CtsHorsIdf: number | null;
  tarifFixeCtsIdf: number | null;
  tarifFixeCtsHorsIdf: number | null;
};

// Suggère (sans jamais imposer) le montant à confier au sous-traitant à
// partir de son tarif négocié par zone (voir SousTraitant.tarifM2Cts.../
// tarifFixeCts..., paramétrage > sous-traitants) et de la surface du poste
// — priorité au tarif/m² s'il existe, sinon le tarif fixe. Rend les 3 champs
// Surface / Sous-traitant / Montant ensemble puisque la suggestion dépend
// des trois à la fois.
export function SousTraitantTarifFields({
  sousTraitants,
  estIdf,
  defaultSurfaceM2,
  defaultSousTraitantId,
  defaultMontant,
}: {
  sousTraitants: SousTraitantAvecTarifs[];
  estIdf: boolean | null;
  defaultSurfaceM2?: number | null;
  defaultSousTraitantId?: string | null;
  defaultMontant?: number | null;
}) {
  const [surfaceM2, setSurfaceM2] = useState(defaultSurfaceM2?.toString() ?? "");
  const [sousTraitantId, setSousTraitantId] = useState(defaultSousTraitantId ?? "");
  const [montant, setMontant] = useState(defaultMontant?.toString() ?? "");

  const sousTraitant = sousTraitants.find((s) => s.id === sousTraitantId);
  const surfaceNum = Number(surfaceM2) || 0;

  let suggestionCts: number | null = null;
  let suggestionLabel = "";
  if (sousTraitant && estIdf !== null) {
    const tarifM2 = estIdf ? sousTraitant.tarifM2CtsIdf : sousTraitant.tarifM2CtsHorsIdf;
    const tarifFixe = estIdf ? sousTraitant.tarifFixeCtsIdf : sousTraitant.tarifFixeCtsHorsIdf;
    if (tarifM2 !== null && surfaceNum > 0) {
      suggestionCts = Math.round(tarifM2 * surfaceNum);
      suggestionLabel = `${formatCents(tarifM2)}/m² × ${surfaceNum} m² (${estIdf ? "IDF" : "hors IDF"})`;
    } else if (tarifFixe !== null) {
      suggestionCts = tarifFixe;
      suggestionLabel = `tarif fixe ${estIdf ? "IDF" : "hors IDF"}`;
    }
  }
  const montantSaisiCts = montant ? Math.round(Number(montant) * 100) : null;
  const suggestionDiffere = suggestionCts !== null && suggestionCts !== montantSaisiCts;

  return (
    <>
      <div className="space-y-1">
        <label className={labelClass}>Surface (m²)</label>
        <input
          name="surfaceM2"
          type="number"
          step="0.01"
          value={surfaceM2}
          onChange={(e) => setSurfaceM2(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className={labelClass}>Sous-traitant</label>
        <select
          name="sousTraitantId"
          value={sousTraitantId}
          onChange={(e) => setSousTraitantId(e.target.value)}
          className={inputClass}
        >
          <option value="">—</option>
          {sousTraitants.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nom}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className={labelClass}>Montant pose sous-traitance (€)</label>
        <input
          name="montantPoseSousTraitance"
          type="number"
          step="0.01"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          className={inputClass}
        />
        {suggestionDiffere && (
          <button
            type="button"
            onClick={() => setMontant((suggestionCts! / 100).toFixed(2))}
            className="block text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            Tarif suggéré {formatCents(suggestionCts!)} ({suggestionLabel}) — appliquer
          </button>
        )}
        {sousTraitant && estIdf === null && (
          <p className="text-xs text-amber-600">Code postal du client manquant — zone IDF inconnue, pas de suggestion.</p>
        )}
        {sousTraitant && estIdf !== null && suggestionCts === null && (
          <p className="text-xs text-slate-400">
            Aucun tarif {estIdf ? "IDF" : "hors IDF"} renseigné pour ce sous-traitant.
          </p>
        )}
      </div>
    </>
  );
}
