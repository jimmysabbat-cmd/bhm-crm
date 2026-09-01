"use client";

import { useState } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";
import type { Precarite, TypeTravaux } from "@/generated/prisma/enums";
import { formatCents } from "@/lib/money";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { bareme, baremeLabel, gesteMontantCts } from "@/lib/mpr-geste-baremes";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

const precariteOptions: { value: Precarite; label: string }[] = [
  { value: "TRES_MODESTE", label: "Très modeste" },
  { value: "MODESTE", label: "Modeste" },
  { value: "INTERMEDIAIRE", label: "Intermédiaire" },
  { value: "SUPERIEUR", label: "Supérieur" },
];

// Gestes proposés dans le calculateur (on exclut "Autre", non tarifable).
const gesteTypes = (Object.keys(typeTravauxLabels) as TypeTravaux[]).filter((t) => t !== "AUTRE");

type Ligne = { id: number; type: TypeTravaux; quantite: string };

let nextId = 1;

export function MonogesteCalculator({
  targetInputId,
  defaultPrecarite,
  defaultDateDepot,
}: {
  targetInputId: string;
  defaultPrecarite?: Precarite | null;
  defaultDateDepot?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dateDepot, setDateDepot] = useState(defaultDateDepot ?? "");
  const [precarite, setPrecarite] = useState<Precarite>(defaultPrecarite ?? "TRES_MODESTE");
  const [lignes, setLignes] = useState<Ligne[]>([{ id: nextId++, type: "PAC_AIR_EAU", quantite: "1" }]);

  const baremeActuel = bareme(dateDepot);

  function addLigne() {
    setLignes((ls) => [...ls, { id: nextId++, type: "PAC_AIR_EAU", quantite: "1" }]);
  }
  function removeLigne(id: number) {
    setLignes((ls) => ls.filter((l) => l.id !== id));
  }
  function updateLigne(id: number, patch: Partial<Ligne>) {
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  const totalCts = lignes.reduce((sum, l) => {
    const montant = gesteMontantCts(dateDepot, l.type, precarite, Number(l.quantite) || 0);
    return sum + (montant ?? 0);
  }, 0);

  function apply() {
    const el = document.getElementById(targetInputId) as HTMLInputElement | null;
    if (!el) return;
    el.value = (totalCts / 100).toFixed(2);
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
        Calculer l&apos;aide MPR (monogeste)
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Calculator className="h-3.5 w-3.5" />
          Calculateur aide MPR — monogeste
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
          <label className={labelClass}>Date de dépôt du dossier</label>
          <input
            type="date"
            value={dateDepot}
            onChange={(e) => setDateDepot(e.target.value)}
            className={inputClass}
          />
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
      <p className="text-xs text-slate-500">Barème appliqué : {baremeLabel(dateDepot)}</p>

      <div className="space-y-2">
        {lignes.map((ligne) => {
          const geste = baremeActuel[ligne.type];
          const montant = gesteMontantCts(dateDepot, ligne.type, precarite, Number(ligne.quantite) || 0);
          return (
            <div key={ligne.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white p-2">
              <select
                value={ligne.type}
                onChange={(e) => updateLigne(ligne.id, { type: e.target.value as TypeTravaux })}
                className={`${inputClass} flex-1`}
              >
                {gesteTypes.map((t) => (
                  <option key={t} value={t}>
                    {typeTravauxLabels[t]}
                  </option>
                ))}
              </select>
              {geste && geste.unite !== "fixe" && (
                <input
                  type="number"
                  step="0.01"
                  value={ligne.quantite}
                  onChange={(e) => updateLigne(ligne.id, { quantite: e.target.value })}
                  placeholder={geste.unite === "m2" ? "Surface (m²)" : "Quantité"}
                  className={`w-28 ${inputClass}`}
                />
              )}
              <span className="ml-auto whitespace-nowrap text-sm font-medium">
                {montant === null ? (
                  <span className="text-amber-600">non éligible MPR à cette date</span>
                ) : (
                  <span className="text-emerald-700">{formatCents(montant)}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeLigne(ligne.id)}
                className="text-slate-400 hover:text-red-600"
                aria-label="Retirer ce geste"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addLigne}
          className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un geste
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
        <span className="text-slate-500">Total aide MPR estimée</span>
        <span className="text-lg font-semibold text-emerald-700">{formatCents(totalCts)}</span>
      </div>

      <Button type="button" variant="secondary" className="text-xs" onClick={apply}>
        Utiliser ce montant
      </Button>
    </div>
  );
}
