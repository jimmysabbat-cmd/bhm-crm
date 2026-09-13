"use client";

import { useState, type ReactNode } from "react";

// ============================================================
// P14.2 - bascule entre la vue guidée (par défaut, "une question à la
// fois") et la vue détaillée (QualificationWorkspace + OpportunitesPanel,
// jamais modifiée). Les deux vues sont déjà rendues côté serveur - ce
// composant ne fait que basculer l'affichage, jamais de refetch au
// changement de vue.
// ============================================================

export function QualificationViewToggle({ guided, detailed }: { guided: ReactNode; detailed: ReactNode }) {
  const [vue, setVue] = useState<"guidee" | "detaillee">("guidee");

  return (
    <div>
      <div className="mx-auto flex max-w-4xl justify-end gap-2 px-4 pt-3 sm:px-8">
        <button type="button" onClick={() => setVue("guidee")} className={`rounded-md px-3 py-1 text-xs font-medium ${vue === "guidee" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-600"}`}>
          Vue guidée
        </button>
        <button type="button" onClick={() => setVue("detaillee")} className={`rounded-md px-3 py-1 text-xs font-medium ${vue === "detaillee" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-600"}`}>
          Vue détaillée
        </button>
      </div>
      <div style={{ display: vue === "guidee" ? "block" : "none" }}>{guided}</div>
      <div style={{ display: vue === "detaillee" ? "block" : "none" }}>{detailed}</div>
    </div>
  );
}
