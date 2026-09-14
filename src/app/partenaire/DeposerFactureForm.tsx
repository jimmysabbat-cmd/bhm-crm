"use client";

import { useState } from "react";
import { inputClass, labelClass } from "@/components/ui/field";
import { deposerFactureSousTraitantAction } from "./facture-actions";

// P16 - dépôt d'une facture par le sous-traitant sur une mission TERMINEE
// qui lui appartient. Formulaire replié par défaut pour ne pas polluer la
// vue "Mes missions" quand rien n'est à facturer.

export function DeposerFactureForm({ packageId, prixSuggereEuros }: { packageId: string; prixSuggereEuros: number | null }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
        Déposer ma facture
      </button>
    );
  }

  return (
    <form action={deposerFactureSousTraitantAction} className="mt-2 w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <input type="hidden" name="packageId" value={packageId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1">
          <label className={labelClass}>N° de votre facture</label>
          <input name="numero" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Montant HT (€)</label>
          <input name="montantHT" type="number" step="0.01" required defaultValue={prixSuggereEuros ?? undefined} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Taux TVA</label>
          <select name="tauxTVA" defaultValue="0.20" className={inputClass}>
            <option value="0.20">20 %</option>
            <option value="0.10">10 %</option>
            <option value="0.055">5,5 %</option>
            <option value="0">0 %</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Justificatif (PDF)</label>
          <input name="file" type="file" accept="application/pdf" className={inputClass} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Envoyer ma facture
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Annuler
        </button>
      </div>
    </form>
  );
}
