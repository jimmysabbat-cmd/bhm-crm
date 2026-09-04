"use client";

import { useState, useTransition } from "react";
import { updateUserRoleAction, adminGeneratePasswordResetLinkAction, toggleUserActif } from "../actions";

const ROLES = ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "COMPTA", "COMPTABILITE", "TECHNIQUE", "REGIE", "SOUS_TRAITANT", "TELEPROSPECTEUR", "DELEGATAIRE_CEE"];

export function UserRoleSelect({ userId, role }: { userId: string; role: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(role);

  function change(next: string) {
    setValue(next);
    startTransition(async () => {
      await updateUserRoleAction(userId, next as never);
    });
  }

  return (
    <select value={value} disabled={pending} onChange={(e) => change(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

export function UserRowActions({ userId, actif }: { userId: string; actif: boolean }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  function toggle() {
    startTransition(async () => {
      await toggleUserActif(userId, !actif);
    });
  }

  function resetLink() {
    startTransition(async () => {
      const res = await adminGeneratePasswordResetLinkAction(userId);
      if (res.ok) setLink(res.link);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={resetLink} className="text-xs font-medium text-slate-400 hover:text-emerald-700">
          Lien reset mdp
        </button>
        <button type="button" disabled={pending} onClick={toggle} className="text-xs font-medium text-slate-400 hover:text-red-600">
          {actif ? "Désactiver" : "Réactiver"}
        </button>
      </div>
      {link && <p className="max-w-xs break-all text-right font-mono text-[10px] text-emerald-700">{link}</p>}
    </div>
  );
}
