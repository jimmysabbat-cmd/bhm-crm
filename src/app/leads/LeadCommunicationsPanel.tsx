"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { prepareLeadTemplateEmailAction, sendLeadDraftAction } from "./communication-actions";

// ============================================================
// Communications lead (P11, section 22) - confirmation RDV / relance
// devis / drafts en attente. Pas de SMS/WhatsApp (hors périmètre P11).
// ============================================================

export type LeadEmailDraft = { id: string; sujet: string; destinataire: string; createdAt: string };

export function LeadCommunicationsPanel({
  leadId,
  hasEmail,
  drafts,
  peutPreparer,
  peutEnvoyer,
}: {
  leadId: string;
  hasEmail: boolean;
  drafts: LeadEmailDraft[];
  peutPreparer: boolean;
  peutEnvoyer: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function prepare(templateCode: string) {
    setError(null);
    startTransition(async () => {
      const res = await prepareLeadTemplateEmailAction(leadId, templateCode);
      if (!res.ok) setError(res.error);
    });
  }

  function send(draftId: string) {
    setError(null);
    startTransition(async () => {
      const res = await sendLeadDraftAction(draftId, leadId);
      if (!res.ok) setError(res.error);
    });
  }

  if (!peutPreparer) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Communications</CardTitle>
      </CardHeader>
      <div className="space-y-3 p-5 pt-0">
        {!hasEmail && <p className="text-xs text-amber-600">Aucune adresse email pour ce lead - impossible de préparer un email.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || !hasEmail} onClick={() => prepare("CONFIRMATION_RDV")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Préparer confirmation RDV
          </button>
          <button type="button" disabled={pending || !hasEmail} onClick={() => prepare("RELANCE_DEVIS")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Préparer relance devis
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {drafts.length > 0 && (
          <div className="space-y-2">
            {drafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{d.sujet}</p>
                  <p className="text-xs text-slate-400">À : {d.destinataire}</p>
                </div>
                {peutEnvoyer && (
                  <button type="button" disabled={pending} onClick={() => send(d.id)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    Envoyer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
