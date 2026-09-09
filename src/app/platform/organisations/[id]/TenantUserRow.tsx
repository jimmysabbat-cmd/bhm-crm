"use client";

import { useState, useTransition } from "react";
import {
  platformToggleUserActifAction,
  platformUpdateUserRoleAction,
  platformGeneratePasswordResetLinkAction,
  setPrincipalAdminAction,
  platformRegenerateInvitationAction,
} from "../../tenant-users-actions";

const ROLES = ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "COMPTA", "COMPTABILITE", "TECHNIQUE", "REGIE", "SOUS_TRAITANT", "TELEPROSPECTEUR", "DELEGATAIRE_CEE"];

export function TenantUserRow({ organisationId, userId, role, actif, isPrincipalAdmin }: { organisationId: string; userId: string; role: string; actif: boolean; isPrincipalAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleValue, setRoleValue] = useState(role);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string } | { ok: true; link: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else if ("link" in res) setLink(res.link);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={roleValue}
          disabled={pending}
          onChange={(e) => {
            setRoleValue(e.target.value);
            run(() => platformUpdateUserRoleAction(organisationId, userId, e.target.value as never));
          }}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {roleValue === "ADMIN" && actif && !isPrincipalAdmin && (
          <button type="button" disabled={pending} onClick={() => run(() => setPrincipalAdminAction(organisationId, userId))} className="text-xs font-medium text-slate-400 hover:text-emerald-700">
            Définir admin principal
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => run(() => platformGeneratePasswordResetLinkAction(organisationId, userId))} className="text-xs font-medium text-slate-400 hover:text-emerald-700">
          Lien reset mdp
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => platformToggleUserActifAction(organisationId, userId, !actif))} className="text-xs font-medium text-slate-400 hover:text-red-600">
          {actif ? "Suspendre" : "Réactiver"}
        </button>
      </div>
      {link && <p className="max-w-xs break-all text-right font-mono text-[10px] text-emerald-700">{link}</p>}
      {error && <p className="text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function RegenerateInvitationButton({ organisationId, invitationId }: { organisationId: string; invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    setError(null);
    startTransition(async () => {
      const res = await platformRegenerateInvitationAction(organisationId, invitationId);
      if (!res.ok) setError(res.error);
      else setLink(res.link);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending} onClick={regenerate} className="text-xs font-medium text-emerald-700 hover:underline">
        Régénérer
      </button>
      {link && <p className="max-w-xs break-all text-right font-mono text-[10px] text-emerald-700">{link}</p>}
      {error && <p className="text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
