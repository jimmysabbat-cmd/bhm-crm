"use client";

import { useState, useTransition } from "react";
import { previewRuleAction, runRuleNowAction, toggleRuleActiveAction } from "./actions";
import type { RuleRunSummary } from "@/lib/automations/types";

// ============================================================
// Actions interactives d'une règle (P11, section 19/20) - "Tester" est
// TOUJOURS un dry run (aucun effet réel), "Exécuter" lance réellement la
// règle (respecte son mode : PREPARE_ONLY ne produit que des
// drafts/aperçus, jamais d'envoi/webhook réel).
// ============================================================

export function RuleActions({ ruleId, canManage }: { ruleId: string; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<RuleRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePreview() {
    setError(null);
    startTransition(async () => {
      const res = await previewRuleAction(ruleId);
      if (res.ok) setSummary(res.summary);
      else setError(res.error);
    });
  }

  function handleRun() {
    setError(null);
    startTransition(async () => {
      const res = await runRuleNowAction(ruleId);
      if (res.ok) setSummary(res.summary);
      else setError(res.error);
    });
  }

  function handleToggle() {
    startTransition(async () => {
      await toggleRuleActiveAction(ruleId);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={handlePreview} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Tester
        </button>
        {canManage && (
          <>
            <button type="button" disabled={pending} onClick={handleRun} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Exécuter maintenant
            </button>
            <button type="button" disabled={pending} onClick={handleToggle} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Activer/Désactiver
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {summary && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {summary.matched} entité(s) concernée(s), {summary.executed} exécutée(s), {summary.skipped} ignorée(s), {summary.errors} erreur(s).
        </div>
      )}
    </div>
  );
}
