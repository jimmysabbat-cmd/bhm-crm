"use client";

import { useState } from "react";

type Poste = {
  type: string;
  surfaceM2: string;
  quantite: string;
  materiau: string;
  marqueReference: string;
  epaisseurMm: string;
  resistanceThermique: string;
  materielFourniPar: "" | "DONNEUR_ORDRE" | "ENTREPRISE";
  prixPoseProposeHT: string;
  notesTechniques: string;
};

const vide = (): Poste => ({
  type: "",
  surfaceM2: "",
  quantite: "",
  materiau: "",
  marqueReference: "",
  epaisseurMm: "",
  resistanceThermique: "",
  materielFourniPar: "",
  prixPoseProposeHT: "",
  notesTechniques: "",
});

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const labelClass = "text-xs font-medium uppercase tracking-wide text-slate-500";

// Détail de la pose, prestation par prestation : ce que l'équipe de pose ou
// le sous-traitant doit savoir avant d'intervenir (matériau, épaisseur, R,
// qui fournit le matériel...). Sérialisé en JSON dans le champ "postes",
// revalidé côté serveur (portail-do/actions.ts::parsePostes).
export function PostesEditor({ typeTravauxOptions }: { typeTravauxOptions: [string, string][] }) {
  const [postes, setPostes] = useState<Poste[]>([vide()]);
  const set = (i: number, patch: Partial<Poste>) => setPostes((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-4">
      <input type="hidden" name="postes" value={JSON.stringify(postes)} />
      {postes.map((p, i) => (
        <fieldset key={i} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-semibold text-slate-800">Prestation {postes.length > 1 ? `n°${i + 1}` : ""}</legend>
            {postes.length > 1 && (
              <button type="button" onClick={() => setPostes((ps) => ps.filter((_, j) => j !== i))} className="text-xs text-slate-400 hover:text-red-600">
                Retirer
              </button>
            )}
          </div>
          <div>
            <label className={labelClass}>Type de pose *</label>
            <select required value={p.type} onChange={(e) => set(i, { type: e.target.value })} className={inputClass}>
              <option value="">Choisir...</option>
              {typeTravauxOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={labelClass}>Surface (m²)</label>
              <input inputMode="decimal" value={p.surfaceM2} onChange={(e) => set(i, { surfaceM2: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Quantité</label>
              <input inputMode="numeric" value={p.quantite} onChange={(e) => set(i, { quantite: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Épaisseur (mm)</label>
              <input inputMode="decimal" value={p.epaisseurMm} onChange={(e) => set(i, { epaisseurMm: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Résistance R (m².K/W)</label>
              <input inputMode="decimal" value={p.resistanceThermique} onChange={(e) => set(i, { resistanceThermique: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Matériau / isolant</label>
              <input value={p.materiau} onChange={(e) => set(i, { materiau: e.target.value })} placeholder="Ex. laine de verre soufflée, PSE graphité..." className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Marque / référence produit</label>
              <input value={p.marqueReference} onChange={(e) => set(i, { marqueReference: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Matériel fourni par</label>
              <select value={p.materielFourniPar} onChange={(e) => set(i, { materielFourniPar: e.target.value as Poste["materielFourniPar"] })} className={inputClass}>
                <option value="">Non précisé</option>
                <option value="DONNEUR_ORDRE">Nous (donneur d&apos;ordre)</option>
                <option value="ENTREPRISE">L&apos;entreprise de pose</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Prix de pose proposé (€ HT)</label>
              <input inputMode="decimal" value={p.prixPoseProposeHT} onChange={(e) => set(i, { prixPoseProposeHT: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Détails de pose (support, finition, fixations, accessoires...)</label>
            <textarea rows={2} value={p.notesTechniques} onChange={(e) => set(i, { notesTechniques: e.target.value })} className={inputClass} />
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setPostes((ps) => [...ps, vide()])} className="text-sm font-medium text-emerald-700 hover:underline">
        + Ajouter une prestation
      </button>
    </div>
  );
}
