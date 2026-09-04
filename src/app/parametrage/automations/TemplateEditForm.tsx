"use client";

import { useState, useTransition } from "react";
import { updateEmailTemplateAction } from "./actions";
import { inputClass } from "@/components/ui/field";
import { ALLOWED_VARIABLES } from "@/lib/automations/templates";

export function TemplateEditForm({ templateId, sujetTemplate, bodyTemplate }: { templateId: string; sujetTemplate: string; bodyTemplate: string }) {
  const [pending, startTransition] = useTransition();
  const [sujet, setSujet] = useState(sujetTemplate);
  const [corps, setCorps] = useState(bodyTemplate);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateEmailTemplateAction(templateId, sujet, corps);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <input value={sujet} onChange={(e) => setSujet(e.target.value)} className={inputClass} />
      <textarea value={corps} onChange={(e) => setCorps(e.target.value)} rows={5} className={`${inputClass} font-mono text-xs`} />
      <p className="text-[11px] text-slate-400">Variables autorisées : {ALLOWED_VARIABLES.map((v) => `{{${v}}}`).join(", ")}</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={save} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Enregistrer
        </button>
        {saved && <span className="text-xs text-emerald-600">Enregistré.</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
