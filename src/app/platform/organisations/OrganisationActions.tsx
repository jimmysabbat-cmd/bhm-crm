"use client";

import { useState, useTransition } from "react";
import { setOrganisationStatusAction, enterTenantAction } from "../actions";

export function OrganisationActions({ organisationId, status }: { organisationId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setStatus(next: "ACTIVE" | "SUSPENDED" | "ARCHIVED") {
    setError(null);
    startTransition(async () => {
      const res = await setOrganisationStatusAction(organisationId, next);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={enterTenantAction.bind(null, organisationId)}>
        <button type="submit" className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
          Entrer →
        </button>
      </form>
      {status !== "SUSPENDED" && (
        <button type="button" disabled={pending} onClick={() => setStatus("SUSPENDED")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
          Suspendre
        </button>
      )}
      {status !== "ACTIVE" && (
        <button type="button" disabled={pending} onClick={() => setStatus("ACTIVE")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          Activer
        </button>
      )}
      {status !== "ARCHIVED" && (
        <button type="button" disabled={pending} onClick={() => setStatus("ARCHIVED")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50">
          Archiver
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
