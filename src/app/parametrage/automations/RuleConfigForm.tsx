"use client";

import { useState, useTransition } from "react";
import { updateRuleConfigAction } from "./actions";
import { inputClass } from "@/components/ui/field";

const MODES = ["PREPARE_ONLY", "AUTO", "MANUAL"] as const;

export function RuleConfigForm({ ruleId, mode, delayJours }: { ruleId: string; mode: string; delayJours: number | null }) {
  const [pending, startTransition] = useTransition();
  const [selectedMode, setSelectedMode] = useState(mode);
  const [delai, setDelai] = useState(delayJours ?? 0);
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    startTransition(async () => {
      const res = await updateRuleConfigAction(ruleId, selectedMode as never, delai);
      if (res.ok) setSaved(true);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)} className={`${inputClass} w-40`}>
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input type="number" value={delai} onChange={(e) => setDelai(Number(e.target.value))} className={`${inputClass} w-20`} min={0} />
      <span className="text-xs text-slate-400">jour(s)</span>
      <button type="button" disabled={pending} onClick={save} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
        Enregistrer
      </button>
      {saved && <span className="text-xs text-emerald-600">Enregistré.</span>}
    </div>
  );
}
