"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TypeTravaux } from "@/generated/prisma/enums";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

const typeOptions = (Object.keys(typeTravauxLabels) as TypeTravaux[]).filter((t) => t !== "AUTRE");

const SURFACIQUES = new Set<TypeTravaux>(["ITE", "ITI", "COMBLES", "RAMPANTS", "TOITURE_TERRASSE"]);
const VOLUMIQUES = new Set<TypeTravaux>([
  "CHAUFFE_EAU_THERMODYNAMIQUE",
  "BALLON_THERMODYNAMIQUE",
  "CHAUFFE_EAU_SOLAIRE_INDIVIDUEL",
  "CHAUFFAGE_SOLAIRE_COMBINE",
]);

// Unité pertinente pour la 2e colonne, selon le geste choisi — évite de
// demander une "surface" pour un chauffe-eau ou un "nombre de splits"
// pour de l'isolation.
function uniteDetail(type: TypeTravaux | ""): { name: string; label: string } | null {
  if (SURFACIQUES.has(type as TypeTravaux)) return { name: "surfaceM2", label: "Surface (m²)" };
  if (VOLUMIQUES.has(type as TypeTravaux)) return { name: "quantite", label: "Volume (L)" };
  if (type === "PAC_AIR_AIR") return { name: "quantite", label: "Nombre de splits" };
  if (type === "PAROIS_VITREES") return { name: "quantite", label: "Nombre de fenêtres" };
  if (type === "") return null;
  return { name: "quantite", label: "Quantité (si plusieurs)" };
}

let nextId = 1;

export function TravauxPrevusFields() {
  const [lignes, setLignes] = useState<{ id: number; type: TypeTravaux | "" }[]>([
    { id: nextId++, type: "" },
  ]);

  function setType(id: number, type: TypeTravaux | "") {
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, type } : l)));
  }

  return (
    <div className="space-y-3">
      {lignes.map((ligne) => {
        const detail = uniteDetail(ligne.type);
        return (
          <div key={ligne.id} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className={labelClass}>Type de travaux</label>
              <select
                name={`travaux.${ligne.id}.type`}
                value={ligne.type}
                onChange={(e) => setType(ligne.id, e.target.value as TypeTravaux)}
                className={inputClass}
              >
                <option value="">—</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {typeTravauxLabels[t]}
                  </option>
                ))}
              </select>
            </div>
            {detail && (
              <div className="space-y-1">
                <label className={labelClass}>{detail.label}</label>
                <input name={`travaux.${ligne.id}.${detail.name}`} type="number" step="0.01" className={inputClass} />
              </div>
            )}
            <div className="col-span-2 flex items-end justify-end sm:col-span-2">
              {lignes.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLignes((ls) => ls.filter((l) => l.id !== ligne.id))}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Retirer
                </button>
              )}
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        className="text-xs"
        onClick={() => setLignes((ls) => [...ls, { id: nextId++, type: "" }])}
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter un geste
      </Button>
    </div>
  );
}
