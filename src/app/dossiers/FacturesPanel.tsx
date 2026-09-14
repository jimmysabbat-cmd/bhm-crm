"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import type { FactureDossierRow, PosteFacturableDonneurOrdre } from "@/lib/facturation/access";
import { creerFactureDonneurOrdreAction, emettreFactureDonneurOrdreAction, annulerFactureAction } from "@/app/facturation/actions";

// P16 - section "Factures" du cockpit dossier : préparation/émission d'une
// facture donneur d'ordre (à partir des postes déjà chiffrés, jamais une
// resaisie de montant) + visibilité sur les factures sous-traitant reçues
// pour ce même dossier. Le règlement (payée/en retard) est calculé côté
// serveur (deriveFactureStatutAffiche) - jamais un second état ici.

const STATUT_LABELS: Record<string, string> = {
  BROUILLON: "Brouillon",
  EMISE: "Émise",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  EN_RETARD: "En retard",
  ANNULEE: "Annulée",
  LITIGE: "Litige",
};
const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  BROUILLON: "slate",
  EMISE: "blue",
  PARTIELLEMENT_PAYEE: "amber",
  PAYEE: "emerald",
  EN_RETARD: "red",
  ANNULEE: "slate",
  LITIGE: "red",
};

function FactureRow({ facture }: { facture: FactureDossierRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm first:border-t-0">
      <div>
        <div className="font-medium text-slate-900">
          {facture.numero} <span className="text-slate-400">({facture.type === "DONNEUR_ORDRE" ? "donneur d'ordre" : "sous-traitant"})</span>
        </div>
        <div className="text-xs text-slate-500">
          {facture.destinataireNom} · {formatCents(facture.montantTTCCts)} TTC
          {facture.dateEcheance && ` · échéance ${facture.dateEcheance.toLocaleDateString("fr-FR")}`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {facture.fichierPdfPath && (
          <a href={`/api/factures/${facture.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-600 hover:underline">
            PDF
          </a>
        )}
        <Badge color={STATUT_COLORS[facture.statutAffiche] ?? "slate"}>{STATUT_LABELS[facture.statutAffiche] ?? facture.statutAffiche}</Badge>
        {facture.type === "DONNEUR_ORDRE" && facture.statutAffiche === "BROUILLON" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => emettreFactureDonneurOrdreAction(facture.id))}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Émettre
          </button>
        )}
        {(facture.statutAffiche === "BROUILLON" || facture.statutAffiche === "EMISE") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Annuler la facture ${facture.numero} ?`)) startTransition(() => annulerFactureAction(facture.id));
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

export function FacturesPanel({
  dossierId,
  factures,
  postesFacturables,
}: {
  dossierId: string;
  factures: FactureDossierRow[];
  postesFacturables: PosteFacturableDonneurOrdre[];
}) {
  const disponibles = postesFacturables.filter((p) => !p.dejaFacture);

  if (factures.length === 0 && disponibles.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Factures ({factures.length})</div>
      {factures.length > 0 && (
        <div>
          {factures.map((f) => (
            <FactureRow key={f.id} facture={f} />
          ))}
        </div>
      )}

      {disponibles.length > 0 && (
        <form action={creerFactureDonneurOrdreAction} className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-4">
          <input type="hidden" name="dossierId" value={dossierId} />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nouvelle facture donneur d&apos;ordre</p>
          <div className="space-y-1.5">
            {disponibles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="posteIds" value={p.id} defaultChecked className="h-4 w-4 rounded border-slate-300" />
                {p.type}
                {p.surfaceM2 ? ` — ${p.surfaceM2} m²` : ""} · {formatCents(p.montantDevisHTCts)} HT
              </label>
            ))}
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <label className={labelClass}>Échéance</label>
              <input type="date" name="dateEcheance" className={inputClass} />
            </div>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Créer la facture (brouillon)
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
