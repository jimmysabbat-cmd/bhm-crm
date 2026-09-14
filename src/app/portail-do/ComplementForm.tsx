"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { repondreComplementAction } from "./actions";

export function ComplementForm({ dossierId, message }: { dossierId: string; message: string }) {
  const [reponse, setReponse] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <div className="mt-2 text-sm text-emerald-700">Votre réponse a bien été envoyée.</div>;

  return (
    <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-800">Information requise : {message}</p>
      <textarea value={reponse} onChange={(e) => setReponse(e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <Button
        type="button"
        disabled={pending || !reponse.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await repondreComplementAction(dossierId, reponse);
            if (!res.ok) setError(res.error);
            else setDone(true);
          })
        }
      >
        Compléter ma demande
      </Button>
    </div>
  );
}
