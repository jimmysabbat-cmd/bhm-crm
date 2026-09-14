"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import type { FactureDossierRow, PosteFacturableDonneurOrdre, FacturationSummary, ReglementRow } from "@/lib/facturation/access";
import {
  creerFactureManuelleAction,
  transmettreFactureAction,
  changerStatutFactureAction,
  ajouterReglementFactureAction,
  supprimerReglementFactureAction,
  validerFactureSousTraitantAction,
  refuserFactureSousTraitantAction,
  annulerFactureAction,
} from "@/app/facturation/actions";

// P16 (MVP dépôt manuel) - section "Factures" du cockpit dossier : dépôt
// d'une facture créée à l'extérieur (PDF + montants saisis directement,
// jamais de génération automatique obligatoire), transmission au donneur
// d'ordre, règlements multiples, changement de statut manuel. Le règlement
// (payée/partiellement payée) reste toujours dérivé des ReglementFacture
// réellement enregistrés - jamais une resaisie qui pourrait diverger du
// moteur financier central (P6).

const STATUT_LABELS: Record<string, string> = {
  BROUILLON: "Brouillon",
  A_TRANSMETTRE: "À transmettre",
  TRANSMISE: "Transmise",
  RECUE: "Reçue",
  A_CONTROLER: "À contrôler",
  VALIDEE: "Validée",
  A_PAYER: "À payer",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  EN_RETARD: "En retard",
  REFUSEE: "Refusée",
  ANNULEE: "Annulée",
  LITIGE: "Litige",
  EMISE: "Émise",
};
const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  BROUILLON: "slate",
  A_TRANSMETTRE: "blue",
  TRANSMISE: "blue",
  RECUE: "slate",
  A_CONTROLER: "amber",
  VALIDEE: "blue",
  A_PAYER: "amber",
  PARTIELLEMENT_PAYEE: "amber",
  PAYEE: "emerald",
  EN_RETARD: "red",
  REFUSEE: "red",
  ANNULEE: "slate",
  LITIGE: "red",
  EMISE: "blue",
};
const MODE_LABELS: Record<string, string> = {
  VIREMENT: "Virement",
  CHEQUE: "Chèque",
  CB: "CB",
  ESPECES: "Espèces",
  PRELEVEMENT: "Prélèvement",
  AIDE: "Aide",
  MANDATAIRE: "Mandataire",
  AUTRE: "Autre",
};
const TYPE_LABELS: Record<string, string> = { CLIENT: "Client", DONNEUR_ORDRE: "Donneur d'ordre", SOUS_TRAITANT: "Sous-traitant" };
const STATUTS_MANUELS: (keyof typeof STATUT_LABELS)[] = ["BROUILLON", "A_TRANSMETTRE", "TRANSMISE", "EN_RETARD", "LITIGE", "ANNULEE", "RECUE", "A_CONTROLER", "VALIDEE", "A_PAYER", "REFUSEE"];

function ReglementsList({ facture }: { facture: FactureDossierRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="ml-2 space-y-1 border-l-2 border-slate-100 pl-3">
      {facture.reglements.map((r: ReglementRow) => (
        <div key={r.id} className="flex items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            {formatCents(r.montantCts)} · {MODE_LABELS[r.mode] ?? r.mode} · {new Date(r.date).toLocaleDateString("fr-FR")}
            {r.reference && ` · réf. ${r.reference}`}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("Supprimer ce règlement ?")) startTransition(() => supprimerReglementFactureAction(r.id));
            }}
            className="text-slate-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      ))}
      {facture.reglements.length === 0 && <p className="text-xs text-slate-400">Aucun règlement enregistré.</p>}
    </div>
  );
}

function AjouterReglementForm({ factureId }: { factureId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-emerald-700 hover:underline">
        + Ajouter un règlement
      </button>
    );
  }
  return (
    <form action={ajouterReglementFactureAction} className="mt-1 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
      <input type="hidden" name="factureId" value={factureId} />
      <div className="space-y-0.5">
        <label className="text-[10px] uppercase text-slate-400">Montant (€)</label>
        <input name="montant" type="number" step="0.01" required className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
      </div>
      <div className="space-y-0.5">
        <label className="text-[10px] uppercase text-slate-400">Date</label>
        <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
      </div>
      <div className="space-y-0.5">
        <label className="text-[10px] uppercase text-slate-400">Mode</label>
        <select name="mode" className="rounded border border-slate-300 px-2 py-1 text-xs">
          {Object.entries(MODE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-0.5">
        <label className="text-[10px] uppercase text-slate-400">Référence</label>
        <input name="reference" className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
      </div>
      <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">
        Ajouter
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:underline">
        Annuler
      </button>
    </form>
  );
}

function FactureRow({ facture, donneurOrdreNom }: { facture: FactureDossierRow; donneurOrdreNom: string | null }) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const peutTransmettre = (facture.type === "CLIENT" || facture.type === "DONNEUR_ORDRE") && (facture.statutAffiche === "BROUILLON" || facture.statutAffiche === "A_TRANSMETTRE");
  const peutValiderSt = facture.type === "SOUS_TRAITANT" && !facture.validatedAt && facture.statutAffiche !== "ANNULEE" && facture.statutAffiche !== "REFUSEE";

  return (
    <div className="border-t border-slate-100 px-4 py-3 text-sm first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-slate-900">
            {facture.numero} <span className="text-slate-400">({TYPE_LABELS[facture.type] ?? facture.type})</span>
          </div>
          <div className="text-xs text-slate-500">
            {facture.destinataireNom} · {formatCents(facture.montantTTCCts)} TTC · réglé {formatCents(facture.montantRegleCts)} · reste {formatCents(facture.resteCts)}
            {facture.dateEcheance && ` · échéance ${new Date(facture.dateEcheance).toLocaleDateString("fr-FR")}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {facture.fichierPdfPath && (
            <a href={`/api/factures/${facture.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-600 hover:underline">
              PDF
            </a>
          )}
          <select
            key={facture.statutAffiche}
            defaultValue={facture.statutAffiche}
            disabled={pending}
            onChange={(e) => startTransition(() => changerStatutFactureAction(facture.id, e.target.value as never))}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {STATUTS_MANUELS.map((s) => (
              <option key={s} value={s}>
                {STATUT_LABELS[s]}
              </option>
            ))}
            {(facture.statutAffiche === "PARTIELLEMENT_PAYEE" || facture.statutAffiche === "PAYEE") && (
              <option value={facture.statutAffiche}>{STATUT_LABELS[facture.statutAffiche]}</option>
            )}
          </select>
          <Badge color={STATUT_COLORS[facture.statutAffiche] ?? "slate"}>{STATUT_LABELS[facture.statutAffiche] ?? facture.statutAffiche}</Badge>
          {peutTransmettre && (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => transmettreFactureAction(facture.id, facture.type === "DONNEUR_ORDRE" ? (donneurOrdreNom ?? "Donneur d'ordre") : "Client"))}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Transmettre
            </button>
          )}
          {peutValiderSt && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => validerFactureSousTraitantAction(facture.id))}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Valider
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => refuserFactureSousTraitantAction(facture.id, ""))}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Refuser
              </button>
            </>
          )}
          {(facture.statutAffiche === "BROUILLON" || facture.statutAffiche === "A_TRANSMETTRE" || facture.statutAffiche === "TRANSMISE") && (
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
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-slate-400 hover:underline">
            {expanded ? "Masquer" : "Règlements"} ({facture.reglements.length})
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1">
          <ReglementsList facture={facture} />
          {facture.mouvementFinancierId && <AjouterReglementForm factureId={facture.id} />}
          {!facture.mouvementFinancierId && <p className="text-xs text-slate-400">Transmettez ou validez d&apos;abord la facture pour pouvoir enregistrer un règlement.</p>}
        </div>
      )}
    </div>
  );
}

function AjouterFactureForm({
  dossierId,
  aUnDonneurOrdre,
  postes,
  sousTraitants,
}: {
  dossierId: string;
  aUnDonneurOrdre: boolean;
  postes: { id: string; label: string }[];
  sousTraitants: { id: string; nom: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"CLIENT" | "DONNEUR_ORDRE" | "SOUS_TRAITANT">("CLIENT");
  const [reprise, setReprise] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
        + Ajouter une facture
      </button>
    );
  }

  return (
    <form action={creerFactureManuelleAction} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className={labelClass}>Type</label>
          <select name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputClass}>
            <option value="CLIENT">Client</option>
            {aUnDonneurOrdre && <option value="DONNEUR_ORDRE">Donneur d&apos;ordre</option>}
            <option value="SOUS_TRAITANT">Sous-traitant</option>
          </select>
        </div>
        {type === "SOUS_TRAITANT" && (
          <div className="space-y-1">
            <label className={labelClass}>Sous-traitant</label>
            <select name="sousTraitantId" required className={inputClass}>
              {sousTraitants.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className={labelClass}>Poste concerné</label>
          <select name="posteTravauxId" className={inputClass}>
            <option value="">—</option>
            {postes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Numéro de facture</label>
          <input name="numero" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Date facture</label>
          <input name="dateFacture" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Date échéance</label>
          <input name="dateEcheance" type="date" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Montant HT (€)</label>
          <input name="montantHT" type="number" step="0.01" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Taux TVA</label>
          <select name="tauxTVA" defaultValue="0.20" className={inputClass}>
            <option value="0.20">20 %</option>
            <option value="0.10">10 %</option>
            <option value="0.055">5,5 %</option>
            <option value="0">0 %</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className={labelClass}>Commentaire</label>
          <input name="commentaire" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>PDF de la facture</label>
          <input name="file" type="file" accept="application/pdf" className={inputClass} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={reprise} onChange={(e) => setReprise(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        Reprise : cette facture a déjà été transmise / réglée avant d&apos;utiliser le CRM
      </label>

      {reprise && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label className={labelClass}>Statut initial</label>
            <select name="statutInitial" defaultValue={type === "SOUS_TRAITANT" ? "A_PAYER" : "TRANSMISE"} className={inputClass}>
              {type === "SOUS_TRAITANT" ? (
                <>
                  <option value="VALIDEE">Déjà validée</option>
                  <option value="A_PAYER">Déjà validée, à payer</option>
                  <option value="PAYEE">Déjà payée</option>
                </>
              ) : (
                <>
                  <option value="TRANSMISE">Déjà transmise</option>
                  <option value="PARTIELLEMENT_PAYEE">Déjà partiellement réglée</option>
                  <option value="PAYEE">Déjà totalement réglée</option>
                </>
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Montant déjà réglé (€)</label>
            <input name="montantDejaRegle" type="number" step="0.01" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date de ce règlement</label>
            <input name="reglementDate" type="date" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Mode</label>
            <select name="reglementMode" defaultValue="AUTRE" className={inputClass}>
              {Object.entries(MODE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Enregistrer la facture
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Annuler
        </button>
      </div>
    </form>
  );
}

export function FacturesPanel({
  dossierId,
  factures,
  postesFacturables,
  summary,
  aUnDonneurOrdre,
  donneurOrdreNom,
  postes,
  sousTraitants,
}: {
  dossierId: string;
  factures: FactureDossierRow[];
  postesFacturables: PosteFacturableDonneurOrdre[];
  summary: FacturationSummary;
  aUnDonneurOrdre: boolean;
  donneurOrdreNom: string | null;
  postes: { id: string; label: string }[];
  sousTraitants: { id: string; nom: string }[];
}) {
  void postesFacturables;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Facturation</div>
      <div className="grid grid-cols-3 gap-4 border-b border-slate-100 px-4 py-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Facturé</p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900">{formatCents(summary.factureCts)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Encaissé</p>
          <p className="mt-0.5 text-lg font-semibold text-emerald-700">{formatCents(summary.encaisseCts)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Reste à encaisser</p>
          <p className="mt-0.5 text-lg font-semibold text-amber-700">{formatCents(summary.resteAEncaisserCts)}</p>
        </div>
      </div>

      {factures.length > 0 && <div>{factures.map((f) => <FactureRow key={f.id} facture={f} donneurOrdreNom={donneurOrdreNom} />)}</div>}
      {factures.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Aucune facture pour l&apos;instant.</p>}

      <div className="border-t border-slate-100 p-4">
        <AjouterFactureForm dossierId={dossierId} aUnDonneurOrdre={aUnDonneurOrdre} postes={postes} sousTraitants={sousTraitants} />
      </div>
    </div>
  );
}
