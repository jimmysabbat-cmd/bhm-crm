"use client";

import { useState, useTransition } from "react";
import { resetPasswordAction } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await resetPasswordAction(token, formData);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form action={handleSubmit} className="mt-4 space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Nouveau mot de passe (8 caractères min.)</label>
        <input name="password" type="password" required minLength={8} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Confirmer</label>
        <input name="confirm" type="password" required minLength={8} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        Réinitialiser
      </button>
    </form>
  );
}
