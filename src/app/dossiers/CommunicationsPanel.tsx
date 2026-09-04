"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { prepareDocumentRequestAction, sendDraftAction } from "./communication-actions";

// ============================================================
// Bloc COMMUNICATIONS (P11, section 21) - emails préparés/envoyés,
// relances, actions. Un email préparé n'est jamais envoyé sans action
// explicite (bouton "Envoyer").
// ============================================================

export type CommunicationDraft = { id: string; sujet: string; destinataire: string; statut: string; createdAt: string };
export type CommunicationLog = { id: string; sujet: string; destinataire: string; statut: string; sentAt: string; erreur: string | null };

export function CommunicationsPanel({
  dossierId,
  drafts,
  logs,
  relanceCount,
  lastRelanceAt,
  documentsManquants,
  peutPreparer,
  peutEnvoyer,
}: {
  dossierId: string;
  drafts: CommunicationDraft[];
  logs: CommunicationLog[];
  relanceCount: number;
  lastRelanceAt: string | null;
  documentsManquants: number;
  peutPreparer: boolean;
  peutEnvoyer: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handlePrepare() {
    setError(null);
    startTransition(async () => {
      const res = await prepareDocumentRequestAction(dossierId);
      if (!res.ok) setError(res.error);
    });
  }

  function handleSend(draftId: string) {
    setError(null);
    startTransition(async () => {
      const res = await sendDraftAction(draftId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Communications</CardTitle>
      </CardHeader>
      <div className="space-y-4 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-3">
          {peutPreparer && documentsManquants > 0 && (
            <button type="button" disabled={pending} onClick={handlePrepare} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Préparer une demande de pièces manquantes ({documentsManquants})
            </button>
          )}
          <span className="text-xs text-slate-400">
            {relanceCount} relance(s) documentaire(s){lastRelanceAt ? ` · dernière le ${new Date(lastRelanceAt).toLocaleDateString("fr-FR")}` : ""}
          </span>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}

        {drafts.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Brouillons en attente</p>
            <div className="space-y-2">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{d.sujet}</p>
                    <p className="text-xs text-slate-400">À : {d.destinataire}</p>
                  </div>
                  {peutEnvoyer && (
                    <button type="button" disabled={pending} onClick={() => handleSend(d.id)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      Envoyer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Historique d&apos;envoi</p>
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{l.sujet}</p>
                    <p className="text-xs text-slate-400">
                      À : {l.destinataire} · {new Date(l.sentAt).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <Badge color={l.statut === "ENVOYE" ? "emerald" : "red"}>{l.statut}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {drafts.length === 0 && logs.length === 0 && <p className="text-sm text-slate-400">Aucune communication pour ce dossier.</p>}
      </div>
    </Card>
  );
}
