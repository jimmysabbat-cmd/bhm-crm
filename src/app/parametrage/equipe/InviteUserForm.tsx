"use client";

import { useState, useTransition } from "react";
import { inviteUserAction } from "../actions";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";

export function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setLink(null);
    startTransition(async () => {
      const res = await inviteUserAction(formData);
      if (res.ok) setLink(res.link);
      else setError(res.error);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
      <h2 className="text-sm font-semibold text-slate-900">Inviter un membre par lien</h2>
      <p className="text-xs text-slate-500">
        Génère un lien sécurisé à usage unique (valable 7 jours) que la personne utilise pour créer elle-même son mot de
        passe - aucun envoi email automatique en P12, à transmettre manuellement.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelClass}>Email</label>
          <input name="email" type="email" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Rôle</label>
          <select name="role" defaultValue="COMMERCIAL" className={inputClass}>
            <option value="COMMERCIAL">Commercial</option>
            <option value="COMPTA">Comptabilité</option>
            <option value="ADMINISTRATIF">Administratif</option>
            <option value="TECHNIQUE">Technique</option>
            <option value="ADMIN">Administrateur</option>
          </select>
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Générer le lien d&apos;invitation
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {link && (
        <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
          <p className="font-medium">Lien à transmettre (affiché une seule fois) :</p>
          <p className="mt-1 break-all font-mono">{link}</p>
        </div>
      )}
    </form>
  );
}
