"use client";

import { useState, useTransition } from "react";
import { acceptInvitationAction } from "./actions";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await acceptInvitationAction(token, formData);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Votre nom</label>
        <input name="name" required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Mot de passe (8 caractères min.)</label>
        <input name="password" type="password" required minLength={8} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Confirmer le mot de passe</label>
        <input name="confirm" type="password" required minLength={8} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        Créer mon compte
      </button>
    </form>
  );
}
