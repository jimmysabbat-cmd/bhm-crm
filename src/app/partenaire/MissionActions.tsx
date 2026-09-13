"use client";

import { useState, useTransition } from "react";
import { accepterMissionAction, refuserMissionAction } from "@/app/dossiers/mission-actions";

export function MissionActions({ packageId, status }: { packageId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== "ENVOYEE") return null;

  return (
    <div className="flex items-center gap-2 pt-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await accepterMissionAction(packageId);
            if (!res.ok) setError(res.error);
          })
        }
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Accepter
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await refuserMissionAction(packageId, null);
            if (!res.ok) setError(res.error);
          })
        }
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Refuser
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
