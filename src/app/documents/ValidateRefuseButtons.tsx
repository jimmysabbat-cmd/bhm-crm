"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { smallInputClass } from "@/components/ui/field";
import { validateDossierDocument, refuseDossierDocument } from "../dossiers/document-actions";

export function ValidateRefuseButtons({ docId }: { docId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  if (refusing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif" className={smallInputClass} />
        <Button
          type="button"
          variant="danger"
          className="text-xs"
          disabled={isPending || !reason.trim()}
          onClick={() => startTransition(async () => { await refuseDossierDocument(docId, reason); router.refresh(); })}
        >
          OK
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button type="button" variant="ghost" className="text-xs" disabled={isPending} onClick={() => startTransition(async () => { await validateDossierDocument(docId); router.refresh(); })}>
        Valider
      </Button>
      <Button type="button" variant="ghost" className="text-xs text-red-600" disabled={isPending} onClick={() => setRefusing(true)}>
        Refuser
      </Button>
    </span>
  );
}
