"use client";

import { useState, useTransition } from "react";
import { calculerOpportunitesPourLead, getNextBestQuestionPourLead, confirmerRdvQualification, getArgumentairePourOpportunite } from "./qualification-actions";
import { saveQuestionnaireAnswers, type QuestionnaireAnswerInput } from "./lead-actions";
import { RevenusBlock, type CategorieMenageVm } from "./RevenusBlock";
import { EnrichissementBlock } from "./EnrichissementBlock";
import type { OpportuniteDetectee } from "@/lib/opportunites/types";
import type { ArgumentaireBlocs } from "@/lib/opportunites/argumentaire";

// ============================================================
// Panneau P14 : Moteur Opportunités + Next Best Question + enrichissement
// adresse + confirmation RDV, en complément de QualificationWorkspace
// (jamais modifié - ce panneau est additif et autonome).
//
// P14.1 : UI revenus interactive (extraite dans RevenusBlock, P14.2).
// P14.2 : enrichissement extrait dans EnrichissementBlock (confirmation
// groupée + sélection DPE multi-candidats), argumentaire dynamique par
// opportunité (audit section 13).
// ============================================================

type Opportunite = OpportuniteDetectee;
type NbqQuestionVm = { id: string; code: string; libelle: string; type: string; obligatoire: boolean; categorieImpact: string | null };

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
  initialCategorieDeclaree,
  hasAdresse,
  revenusQuestions,
}: {
  leadId: string;
  questionnaireVersionId: string | null;
  initialOpportunites: Opportunite[];
  initialNbq: { question: NbqQuestionVm | null; reasons: string[] } | null;
  initialCategorieMenage: CategorieMenageVm | null;
  /** Catégorie déjà déclarée directement (code, ex. "MODESTE") lors d'une session précédente - survit à un rechargement, contrairement à un simple état client (P14.1). */
  initialCategorieDeclaree: string | null;
  hasAdresse: boolean;
  /** code de question -> id, pour les 6 questions revenus/foyer (P14.1). Vide si le tenant n'a pas encore cette version du questionnaire (jamais bloquant). */
  revenusQuestions: Record<string, string>;
}) {
  const [opportunites, setOpportunites] = useState(initialOpportunites);
  const [nbq, setNbq] = useState(initialNbq);
  const [rdvDate, setRdvDate] = useState("");
  const [rdvHeure, setRdvHeure] = useState("14:00");
  const [rdvMessage, setRdvMessage] = useState<string | null>(null);
  const [argumentaireOuvert, setArgumentaireOuvert] = useState<string | null>(null);
  const [argumentaire, setArgumentaire] = useState<ArgumentaireBlocs | null>(null);
  const [pending, startTransition] = useTransition();

  function refreshOpportunitesEtNbq() {
    startTransition(async () => {
      const [opRes, nbqRes] = await Promise.all([calculerOpportunitesPourLead(leadId), getNextBestQuestionPourLead(leadId)]);
      if (opRes.ok) setOpportunites(opRes.result.opportunites);
      if (nbqRes.ok) setNbq(nbqRes.result);
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

  function toggleArgumentaire(ficheMetierId: string) {
    if (argumentaireOuvert === ficheMetierId) {
      setArgumentaireOuvert(null);
      setArgumentaire(null);
      return;
    }
    setArgumentaireOuvert(ficheMetierId);
    setArgumentaire(null);
    startTransition(async () => {
      const res = await getArgumentairePourOpportunite(leadId, ficheMetierId);
      if (res.ok) setArgumentaire(res.result);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pb-8 sm:px-8">
      <EnrichissementBlock leadId={leadId} hasAdresse={hasAdresse} onChanged={refreshOpportunitesEtNbq} />

      <RevenusBlock
        leadId={leadId}
        questionnaireVersionId={questionnaireVersionId}
        initialCategorieMenage={initialCategorieMenage}
        initialCategorieDeclaree={initialCategorieDeclaree}
        revenusQuestions={revenusQuestions}
        onChanged={refreshOpportunitesEtNbq}
      />

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
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {o.niveau.replace("_", " ")}
                  <button type="button" onClick={() => toggleArgumentaire(o.ficheMetierId)} className="rounded border border-current px-2 py-0.5 text-[11px] font-normal">
                    {argumentaireOuvert === o.ficheMetierId ? "Masquer" : "Argumentaire"}
                  </button>
                </span>
              </div>
              {o.raisonsPositives.length > 0 && <p className="mt-1 text-xs">+ {o.raisonsPositives.join(" · ")}</p>}
              {o.informationsManquantes.length > 0 && <p className="mt-1 text-xs opacity-70">À vérifier : {o.informationsManquantes.join(", ")}</p>}

              {argumentaireOuvert === o.ficheMetierId && (
                <div className="mt-3 space-y-2 rounded-md border border-white/60 bg-white/70 p-3 text-xs text-neutral-800">
                  {!argumentaire && pending && <p className="text-neutral-400">Chargement…</p>}
                  {argumentaire && (
                    <>
                      {argumentaire.pourquoi && (
                        <p>
                          <strong>Pourquoi cette solution ?</strong> {argumentaire.pourquoi}
                        </p>
                      )}
                      {argumentaire.benefices && (
                        <p>
                          <strong>Bénéfices :</strong> {argumentaire.benefices}
                        </p>
                      )}
                      <p>
                        <strong>Aides potentielles :</strong> {argumentaire.aides}
                      </p>
                      {argumentaire.aConfirmer && (
                        <p>
                          <strong>Points à confirmer :</strong> {argumentaire.aConfirmer}
                        </p>
                      )}
                      {argumentaire.prochaineEtape && (
                        <p>
                          <strong>Prochaine étape :</strong> {argumentaire.prochaineEtape}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
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
