"use client";

import { useState, useTransition } from "react";
import {
  lancerEnrichissementAdresse,
  confirmerChampPropose,
  confirmerPlusieursChamps,
  choisirDpeCandidat,
  getPropositionsEnAttente,
  type PropositionEnAttente,
} from "./enrichissement-actions";
import type { DpeData } from "@/lib/connectors/types";

// ============================================================
// Bloc enrichissement adresse/DPE (P14/P14.1, extrait+étendu en composant
// partagé pour P14.2 - audit sections 5/6) :
//   - confirmation GROUPÉE de tout un lot de propositions en un clic, tout
//     en conservant la provenance individuelle par champ ;
//   - sélection EXPLICITE quand plusieurs candidats DPE existent, jamais un
//     choix silencieux du premier résultat.
// ============================================================

type DpeCandidatVm = DpeData;

const SOURCE_LABEL: Record<string, string> = { CLIENT: "Client", COMMERCIAL: "Commercial", VISITE: "Visite", AUDIT: "Audit", API: "API", DOCUMENT: "Document", IMPORT: "Import", AUTRE: "Autre" };
const CONFIANCE_PROPOSEE_LABEL: Record<string, string> = { FAIBLE: "Faible", MOYENNE: "Moyenne", ELEVEE: "Élevée" };

export function EnrichissementBlock({ leadId, hasAdresse, onChanged }: { leadId: string; hasAdresse: boolean; onChanged?: () => void }) {
  const [propositions, setPropositions] = useState<PropositionEnAttente[]>([]);
  const [confirmations, setConfirmations] = useState<{ champ: string; valeur: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dpeCandidats, setDpeCandidats] = useState<DpeCandidatVm[]>([]);
  const [pending, startTransition] = useTransition();

  function lancer() {
    startTransition(async () => {
      const res = await lancerEnrichissementAdresse(leadId);
      if (!res.ok) {
        setMessage(res.error);
        return;
      }
      setDpeCandidats(res.result.dpeCandidatsAConfirmer);
      const nbPropositions = res.result.propositions.length;
      setMessage(
        res.result.dpeCandidatsAConfirmer.length > 1
          ? `${nbPropositions} donnée(s) trouvée(s) - ${res.result.dpeCandidatsAConfirmer.length} DPE possibles, sélection requise ci-dessous.`
          : nbPropositions > 0
            ? `${nbPropositions} donnée(s) trouvée(s) - à confirmer ci-dessous.`
            : "Aucune donnée trouvée."
      );
      if (res.result.erreurs.length > 0) setMessage((m) => `${m ?? ""} (${res.result.erreurs.join(" ; ")})`);
      const props = await getPropositionsEnAttente(leadId);
      if (props.ok) setPropositions(props.propositions);
    });
  }

  function reconcilier(champProvenanceId: string, decision: "ACCEPTER" | "REFUSER") {
    startTransition(async () => {
      const proposition = propositions.find((p) => p.id === champProvenanceId);
      await confirmerChampPropose(leadId, champProvenanceId, decision);
      setPropositions((prev) => prev.filter((p) => p.id !== champProvenanceId));
      if (decision === "ACCEPTER" && proposition) setConfirmations((prev) => [...prev, { champ: proposition.champ, valeur: proposition.valeurProposee }]);
      onChanged?.();
    });
  }

  function confirmerToutLeLot() {
    if (propositions.length === 0) return;
    startTransition(async () => {
      const ids = propositions.map((p) => p.id);
      const snapshot = [...propositions];
      const res = await confirmerPlusieursChamps(leadId, ids);
      if (res.ok) {
        setConfirmations((prev) => [...prev, ...snapshot.map((p) => ({ champ: p.champ, valeur: p.valeurProposee }))]);
        setPropositions([]);
      }
      onChanged?.();
    });
  }

  function choisirCandidat(candidat: DpeCandidatVm) {
    startTransition(async () => {
      await choisirDpeCandidat(leadId, candidat, "data.ademe.fr (DPE v2 logements existants)", "MEDIUM");
      setDpeCandidats([]);
      const props = await getPropositionsEnAttente(leadId);
      if (props.ok) setPropositions(props.propositions);
      onChanged?.();
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Enrichissement automatique</h3>
        <button type="button" onClick={lancer} disabled={!hasAdresse || pending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          Rechercher (adresse / DPE)
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-neutral-500">{message}</p>}

      {dpeCandidats.length > 1 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-amber-700">Plusieurs DPE trouvés pour cette adresse - sélectionnez le bon (jamais choisi automatiquement) :</p>
          {dpeCandidats.map((c, i) => (
            <div key={c.numeroDpe ?? i} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span>
                DPE {i + 1} — Classe {c.etiquette ?? "?"} · {c.surfaceHabitableM2 ?? "?"} m² · établi le {c.dateEtablissementDpe ?? "date inconnue"} · réf. {c.numeroDpe ?? "?"}
              </span>
              <button type="button" onClick={() => choisirCandidat(c)} disabled={pending} className="shrink-0 rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-40">
                Sélectionner
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setDpeCandidats([])} className="text-xs text-neutral-500 underline">
            Ignorer les DPE trouvés
          </button>
        </div>
      )}

      {propositions.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-neutral-500">{propositions.length} champ(s) à confirmer.</p>
            <button type="button" onClick={confirmerToutLeLot} disabled={pending} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              Utiliser ces données (tout confirmer)
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {propositions.map((p) => (
              <li key={p.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <strong>{p.champ}</strong> : donnée trouvée <strong>{p.valeurProposee}</strong>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => reconcilier(p.id, "ACCEPTER")} className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                      Confirmer
                    </button>
                    <button type="button" onClick={() => reconcilier(p.id, "REFUSER")} className="rounded bg-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                      Ignorer
                    </button>
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500">
                  <span>Source : {SOURCE_LABEL[p.sourceProposee ?? ""] ?? p.sourceProposee ?? "Inconnue"}</span>
                  {p.confianceProposee && <span>Confiance : {CONFIANCE_PROPOSEE_LABEL[p.confianceProposee] ?? p.confianceProposee}</span>}
                  <span>Statut : À confirmer</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirmations.length > 0 && (
        <ul className="mt-3 space-y-1">
          {confirmations.map((c, i) => (
            <li key={`${c.champ}-${i}`} className="text-xs text-emerald-700">
              ✓ {c.champ} = {c.valeur} — Statut : Vérifiée
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
