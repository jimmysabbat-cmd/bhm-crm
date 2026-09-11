"use client";

import { useState, useTransition } from "react";
import { calculerOpportunitesPourLead, getNextBestQuestionPourLead, getCategorieMenagePourLead, confirmerRdvQualification } from "./qualification-actions";
import { lancerEnrichissementAdresse, confirmerChampPropose, getPropositionsEnAttente } from "./enrichissement-actions";
import { saveQuestionnaireAnswers, type QuestionnaireAnswerInput } from "./lead-actions";
import type { OpportuniteDetectee } from "@/lib/opportunites/types";

// ============================================================
// Panneau P14 : Moteur Opportunités + Next Best Question + enrichissement
// adresse + confirmation RDV, en complément de QualificationWorkspace
// (jamais modifié - ce panneau est additif et autonome). Une question
// principale à la fois, grandes cartes/boutons (audit section 22/O).
// ============================================================

type Opportunite = OpportuniteDetectee;
type NbqQuestionVm = { id: string; code: string; libelle: string; type: string; obligatoire: boolean; categorieImpact: string | null };
type Proposition = { id: string; champ: string; valeurProposee: string; confiance: string; sourceProposee: string | null };

const NIVEAU_STYLE: Record<string, string> = {
  FORTE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  A_ETUDIER: "bg-amber-100 text-amber-800 border-amber-300",
  FAIBLE: "bg-neutral-100 text-neutral-600 border-neutral-300",
  NON_PERTINENT: "bg-neutral-50 text-neutral-400 border-neutral-200",
};

export function OpportunitesPanel({
  leadId,
  questionnaireVersionId,
  initialOpportunites,
  initialNbq,
  initialCategorieMenage,
  hasAdresse,
}: {
  leadId: string;
  questionnaireVersionId: string | null;
  initialOpportunites: Opportunite[];
  initialNbq: { question: NbqQuestionVm | null; reasons: string[] } | null;
  initialCategorieMenage: { statut: string; categorie: string | null; reasons: string[] } | null;
  hasAdresse: boolean;
}) {
  const [opportunites, setOpportunites] = useState(initialOpportunites);
  const [nbq, setNbq] = useState(initialNbq);
  const [categorieMenage, setCategorieMenage] = useState(initialCategorieMenage);
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [enrichissementMessage, setEnrichissementMessage] = useState<string | null>(null);
  const [rdvDate, setRdvDate] = useState("");
  const [rdvHeure, setRdvHeure] = useState("14:00");
  const [rdvMessage, setRdvMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refreshOpportunitesEtNbq() {
    startTransition(async () => {
      const [opRes, nbqRes, menageRes] = await Promise.all([
        calculerOpportunitesPourLead(leadId),
        getNextBestQuestionPourLead(leadId),
        getCategorieMenagePourLead(leadId),
      ]);
      if (opRes.ok) setOpportunites(opRes.result.opportunites);
      if (nbqRes.ok) setNbq(nbqRes.result);
      if (menageRes.ok) setCategorieMenage(menageRes.result);
    });
  }

  function repondreEtAvancer(valeurOptions: string[] | null, valeurBool: boolean | null) {
    if (!nbq?.question || !questionnaireVersionId) return;
    const answer: QuestionnaireAnswerInput = { questionId: nbq.question.id, valeurOptions, valeurBool };
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, [answer]);
      refreshOpportunitesEtNbq();
    });
  }

  function lancerEnrichissement() {
    startTransition(async () => {
      const res = await lancerEnrichissementAdresse(leadId);
      if (!res.ok) {
        setEnrichissementMessage(res.error);
        return;
      }
      setEnrichissementMessage(
        res.result.propositions.length > 0
          ? `${res.result.propositions.length} donnée(s) trouvée(s) - à confirmer ci-dessous.`
          : "Aucune donnée trouvée."
      );
      if (res.result.erreurs.length > 0) setEnrichissementMessage((m) => `${m ?? ""} (${res.result.erreurs.join(" ; ")})`);
      const props = await getPropositionsEnAttente(leadId);
      if (props.ok) setPropositions(props.propositions);
    });
  }

  function reconcilier(champProvenanceId: string, decision: "ACCEPTER" | "REFUSER") {
    startTransition(async () => {
      await confirmerChampPropose(leadId, champProvenanceId, decision);
      setPropositions((prev) => prev.filter((p) => p.id !== champProvenanceId));
      refreshOpportunitesEtNbq();
    });
  }

  function confirmerRdv() {
    if (!rdvDate) {
      setRdvMessage("Date obligatoire.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("date", rdvDate);
      fd.set("heure", rdvHeure);
      fd.set("type", "VISITE");
      const res = await confirmerRdvQualification(leadId, fd);
      setRdvMessage(res.ok ? "RDV confirmé - opportunités figées pour la transmission au commercial." : res.error);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pb-8 sm:px-8">
      {/* Enrichissement adresse */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">Enrichissement automatique</h3>
          <button
            type="button"
            onClick={lancerEnrichissement}
            disabled={!hasAdresse || pending}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Rechercher (adresse / DPE)
          </button>
        </div>
        {enrichissementMessage && <p className="mt-2 text-xs text-neutral-500">{enrichissementMessage}</p>}
        {propositions.length > 0 && (
          <ul className="mt-3 space-y-2">
            {propositions.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <span>
                  <strong>{p.champ}</strong> : donnée trouvée <strong>{p.valeurProposee}</strong>
                  <span className="ml-2 text-xs text-neutral-500">({p.confiance})</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => reconcilier(p.id, "ACCEPTER")} className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                    Confirmer
                  </button>
                  <button type="button" onClick={() => reconcilier(p.id, "REFUSER")} className="rounded bg-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                    Ignorer
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Catégorie revenus */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-900">Catégorie revenus</h3>
        {categorieMenage?.categorie ? (
          <p className="mt-1 text-sm">
            Catégorie estimée : <strong>{categorieMenage.categorie}</strong>
          </p>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">Barème non configuré / à confirmer.</p>
        )}
      </section>

      {/* Question active (Next Best Question) */}
      {nbq?.question && (
        <section className="rounded-lg border-2 border-neutral-900 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Question active</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{nbq.question.libelle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {nbq.question.type === "YES_NO" ? (
              <>
                <button type="button" onClick={() => repondreEtAvancer(null, true)} className="rounded-lg border-2 border-neutral-900 px-6 py-3 text-sm font-semibold">
                  OUI
                </button>
                <button type="button" onClick={() => repondreEtAvancer(null, false)} className="rounded-lg border-2 border-neutral-300 px-6 py-3 text-sm font-semibold">
                  NON
                </button>
              </>
            ) : (
              <p className="text-xs text-neutral-500">Type de question &laquo;&nbsp;{nbq.question.type}&nbsp;&raquo; - à répondre via le formulaire détaillé ci-dessus.</p>
            )}
            <button type="button" onClick={() => repondreEtAvancer(["INCONNU"], null)} className="rounded-lg border border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              Je ne sais pas
            </button>
          </div>
        </section>
      )}
      {!nbq?.question && <p className="text-sm text-neutral-400">Aucune question restante applicable pour le moment.</p>}

      {/* Opportunités détectées */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-900">Opportunités détectées</h3>
        {opportunites.length === 0 && <p className="mt-1 text-sm text-neutral-400">Aucune fiche métier active configurée pour ce tenant.</p>}
        <ul className="mt-2 space-y-2">
          {opportunites.map((o) => (
            <li key={o.ficheMetierId} className={`rounded-md border px-3 py-2 ${NIVEAU_STYLE[o.niveau] ?? ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{o.libelle}</span>
                <span className="text-xs font-semibold">{o.niveau.replace("_", " ")}</span>
              </div>
              {o.raisonsPositives.length > 0 && <p className="mt-1 text-xs">+ {o.raisonsPositives.join(" · ")}</p>}
              {o.informationsManquantes.length > 0 && <p className="mt-1 text-xs opacity-70">À vérifier : {o.informationsManquantes.join(", ")}</p>}
            </li>
          ))}
        </ul>
      </section>

      {/* RDV */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-900">Prendre un RDV</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="date" value={rdvDate} onChange={(e) => setRdvDate(e.target.value)} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
          <input type="time" value={rdvHeure} onChange={(e) => setRdvHeure(e.target.value)} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
          <button type="button" onClick={confirmerRdv} disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Confirmer le RDV
          </button>
        </div>
        {rdvMessage && <p className="mt-2 text-xs text-neutral-500">{rdvMessage}</p>}
      </section>
    </div>
  );
}
