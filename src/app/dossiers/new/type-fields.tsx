"use client";

import { useState } from "react";
import { inputClass, labelClass } from "@/components/ui/field";
import { MprAmpleurCalculator } from "@/components/ui/MprAmpleurCalculator";

type TypeOption = { id: string; key: string; label: string };
type MarOption = { id: string; nom: string };
type DelegataireOption = { id: string; nom: string };

export function TypeFields({
  types,
  mars,
  delegatairesCee,
}: {
  types: TypeOption[];
  mars: MarOption[];
  delegatairesCee: DelegataireOption[];
}) {
  const [typeId, setTypeId] = useState("");
  const selected = types.find((t) => t.id === typeId);
  const isRenoAmpleur = selected?.key.startsWith("RENOVATION_AMPLEUR") ?? false;

  return (
    <>
      <div className="space-y-1">
        <label className={labelClass}>Type de dossier</label>
        <select
          name="typeId"
          required
          className={inputClass}
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          <option value="" disabled>
            Choisir...
          </option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {isRenoAmpleur && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>MAR (accompagnateur Rénov)</label>
            <select name="marId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {mars.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date de dépôt ANAH</label>
            <input name="dateDepotAnah" type="date" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date d&apos;octroi ANAH</label>
            <input name="dateOctroiAnah" type="date" className={inputClass} />
          </div>
          <div className="col-span-2">
            <MprAmpleurCalculator targetInputId="montantAideMPR" />
          </div>
        </>
      )}

      {!isRenoAmpleur && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Aide CEE (€)</label>
            <input name="montantAideCEE" type="number" step="0.01" defaultValue={0} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Délégataire CEE</label>
            <select name="delegataireCeeId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {delegatairesCee.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
