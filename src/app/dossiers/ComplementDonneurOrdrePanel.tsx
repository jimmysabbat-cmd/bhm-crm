"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { demanderComplementAction, deciderDemandeDonneurOrdreAction } from "./complement-actions";

// P16 - demande de complément d'information au donneur d'ordre (déclenche
// DO_COMPLEMENT_REQUIS/DO_COMPLEMENT_RECU, cf. src/lib/automations).
export function ComplementDonneurOrdrePanel({
  dossierId,
  demande,
  reponse,
  donneurOrdreNom,
  statutKey,
  motifRefus,
  referenceDonneurOrdre,
  infosTechniques,
}: {
  referenceDonneurOrdre: string | null;
  infosTechniques: string | null;
  dossierId: string;
  donneurOrdreNom: string;
  statutKey: string;
  motifRefus: string | null;
  demande: { message: string; at: Date } | null;
  reponse: { message: string; at: Date } | null;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const enAttente = demande && !reponse;
  const [refusOpen, setRefusOpen] = useState(false);
  const [motif, setMotif] = useState("");
  const aDecider = statutKey === "PROSPECT_ETUDE";

  function decider(decision: "ACCEPTE" | "REFUSE") {
    startTransition(async () => {
      setError(null);
      const res = await deciderDemandeDonneurOrdreAction(dossierId, decision, motif);
      if (!res.ok) setError(res.error);
      else {
        setRefusOpen(false);
        setMotif("");
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4">
      <div className="text-sm font-medium text-slate-700">Demande du donneur d&apos;ordre · {donneurOrdreNom}</div>

      {(referenceDonneurOrdre || infosTechniques) && (
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          {referenceDonneurOrdre && <div>Réf. donneur d&apos;ordre : {referenceDonneurOrdre}</div>}
          {infosTechniques && <div className="whitespace-pre-line">{infosTechniques}</div>}
        </div>
      )}

      {aDecider && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm text-amber-900">Demande à traiter : acceptez-la ou refusez-la. Le donneur d&apos;ordre voit la décision dans son portail.</div>
          {refusOpen ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Motif du refus (visible par le donneur d'ordre)"
              />
              <div className="flex gap-2">
                <Button type="button" variant="danger" disabled={pending || !motif.trim()} onClick={() => decider("REFUSE")}>
                  Confirmer le refus
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRefusOpen(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button type="button" disabled={pending} onClick={() => decider("ACCEPTE")}>
                Accepter la demande
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setRefusOpen(true)}>
                Refuser
              </Button>
            </div>
          )}
        </div>
      )}
      {motifRefus && statutKey === "REFUSE" && <div className="mt-2 text-sm text-red-700">Refusée : {motifRefus}</div>}
      {error && !open && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {demande && (
        <div className="mt-2 text-sm text-slate-600">
          Demandé le {demande.at.toLocaleDateString("fr-FR")} : {demande.message}
        </div>
      )}
      {reponse && (
        <div className="mt-1 text-sm text-emerald-700">
          Réponse reçue le {reponse.at.toLocaleDateString("fr-FR")} : {reponse.message}
        </div>
      )}
      {enAttente && <div className="mt-1 text-xs text-amber-600">En attente de réponse du donneur d&apos;ordre.</div>}

      {open ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Quelle information manque-t-il ?"
          />
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !message.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await demanderComplementAction(dossierId, message);
                  if (!res.ok) setError(res.error);
                  else {
                    setOpen(false);
                    setMessage("");
                  }
                })
              }
            >
              Envoyer la demande
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" className="mt-3 text-xs" onClick={() => setOpen(true)}>
          Demander un complément
        </Button>
      )}
    </div>
  );
}
