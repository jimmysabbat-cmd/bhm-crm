"use client";

import { useState, useTransition } from "react";
import { calculerOpportunitesPourLead, getNextBestQuestionPourLead, getCategorieMenagePourLead, confirmerRdvQualification } from "./qualification-actions";
import { lancerEnrichissementAdresse, confirmerChampPropose, getPropositionsEnAttente, type PropositionEnAttente } from "./enrichissement-actions";
import { saveQuestionnaireAnswers, type QuestionnaireAnswerInput } from "./lead-actions";
import type { OpportuniteDetectee } from "@/lib/opportunites/types";

// ============================================================
// Panneau P14 : Moteur Opportunités + Next Best Question + enrichissement
// adresse + confirmation RDV, en complément de QualificationWorkspace
// (jamais modifié - ce panneau est additif et autonome). Une question
// principale à la fois, grandes cartes/boutons (audit section 22/O).
//
// P14.1 : distingue clairement SOURCE / CONFIANCE / STATUT pour chaque
// proposition d'enrichissement (jamais confondus - cf. schema.prisma,
// enum NiveauConfianceProposition), et ajoute l'UI revenus interactive.
// ============================================================

type Opportunite = OpportuniteDetectee;
type NbqQuestionVm = { id: string; code: string; libelle: string; type: string; obligatoire: boolean; categorieImpact: string | null };
type CategorieMenageVm = { statut: string; categorie: string | null; reasons: string[]; missingFields?: string[]; provenance?: string | null };

const NIVEAU_STYLE: Record<string, string> = {
  FORTE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  A_ETUDIER: "bg-amber-100 text-amber-800 border-amber-300",
  FAIBLE: "bg-neutral-100 text-neutral-600 border-neutral-300",
  NON_PERTINENT: "bg-neutral-50 text-neutral-400 border-neutral-200",
};

const SOURCE_LABEL: Record<string, string> = {
  CLIENT: "Client",
  COMMERCIAL: "Commercial",
  VISITE: "Visite",
  AUDIT: "Audit",
  API: "API",
  DOCUMENT: "Document",
  IMPORT: "Import",
  AUTRE: "Autre",
};

const CONFIANCE_PROPOSEE_LABEL: Record<string, string> = {
  FAIBLE: "Faible",
  MOYENNE: "Moyenne",
  ELEVEE: "Élevée",
};

const CATEGORIE_OPTIONS = ["TRES_MODESTE", "MODESTE", "INTERMEDIAIRE", "SUPERIEUR"] as const;
const TYPE_OCCUPANT_OPTIONS = ["PROPRIETAIRE", "LOCATAIRE", "BAILLEUR"] as const;

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
  const [categorieMenage, setCategorieMenage] = useState<CategorieMenageVm | null>(initialCategorieMenage);
  const [propositions, setPropositions] = useState<PropositionEnAttente[]>([]);
  const [confirmations, setConfirmations] = useState<{ champ: string; valeur: string }[]>([]);
  const [enrichissementMessage, setEnrichissementMessage] = useState<string | null>(null);
  const [rdvDate, setRdvDate] = useState("");
  const [rdvHeure, setRdvHeure] = useState("14:00");
  const [rdvMessage, setRdvMessage] = useState<string | null>(null);
  const [revenusMode, setRevenusMode] = useState<"choix" | "calcul" | null>(null);
  const [revenusForm, setRevenusForm] = useState({ nombrePersonnes: "", rfr: "", annee: "", typeOccupant: "" });
  // P14.1 - `categorieMenage` (calculateCategorieMenage) ne représente QUE le
  // résultat d'un calcul par barème ; une catégorie déclarée directement par
  // le client n'y apparaît jamais (ce n'est pas un calcul). État local dédié,
  // affiché en priorité, pour ne jamais faire croire qu'une valeur déclarée a
  // été calculée (audit section 3 : "ne jamais prétendre qu'une valeur a été
  // calculée si elle vient d'un choix direct, et vice-versa").
  const [categorieDeclaree, setCategorieDeclaree] = useState<string | null>(initialCategorieDeclaree);
  const [pending, startTransition] = useTransition();

  const aQuestionsRevenus = Object.keys(revenusQuestions).length > 0;

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
      const proposition = propositions.find((p) => p.id === champProvenanceId);
      await confirmerChampPropose(leadId, champProvenanceId, decision);
      setPropositions((prev) => prev.filter((p) => p.id !== champProvenanceId));
      if (decision === "ACCEPTER" && proposition) {
        setConfirmations((prev) => [...prev, { champ: proposition.champ, valeur: proposition.valeurProposee }]);
      }
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

  function declarerCategorie(code: string) {
    const questionId = revenusQuestions.CATEGORIE_REVENUS_DECLAREE;
    if (!questionId || !questionnaireVersionId) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, [{ questionId, valeurOptions: [code] }]);
      setCategorieDeclaree(code);
      setRevenusMode(null);
      refreshOpportunitesEtNbq();
    });
  }

  function calculerCategorie() {
    if (!questionnaireVersionId) return;
    const answers: QuestionnaireAnswerInput[] = [];
    if (revenusQuestions.NOMBRE_PERSONNES_FOYER && revenusForm.nombrePersonnes) {
      answers.push({ questionId: revenusQuestions.NOMBRE_PERSONNES_FOYER, valeurNombre: Number(revenusForm.nombrePersonnes) });
    }
    if (revenusQuestions.REVENU_FISCAL_REFERENCE && revenusForm.rfr) {
      answers.push({ questionId: revenusQuestions.REVENU_FISCAL_REFERENCE, valeurNombre: Number(revenusForm.rfr) });
    }
    if (revenusQuestions.ANNEE_REFERENCE_REVENU && revenusForm.annee) {
      answers.push({ questionId: revenusQuestions.ANNEE_REFERENCE_REVENU, valeurNombre: Number(revenusForm.annee) });
    }
    if (revenusQuestions.TYPE_OCCUPANT && revenusForm.typeOccupant) {
      answers.push({ questionId: revenusQuestions.TYPE_OCCUPANT, valeurOptions: [revenusForm.typeOccupant] });
    }
    if (answers.length === 0) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, answers);
      const res = await getCategorieMenagePourLead(leadId);
      if (res.ok) setCategorieMenage(res.result);
    });
  }

  function confirmerCategorieCalculee() {
    const questionId = revenusQuestions.CATEGORIE_REVENUS_CALCULEE;
    if (!questionId || !questionnaireVersionId || !categorieMenage?.categorie) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, [{ questionId, valeurOptions: [categorieMenage.categorie!] }]);
      setRevenusMode(null);
      refreshOpportunitesEtNbq();
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
                {/* P14.1 - Source / Confiance / Statut distincts, jamais confondus. */}
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500">
                  <span>Source : {SOURCE_LABEL[p.sourceProposee ?? ""] ?? p.sourceProposee ?? "Inconnue"}</span>
                  {p.confianceProposee && <span>Confiance : {CONFIANCE_PROPOSEE_LABEL[p.confianceProposee] ?? p.confianceProposee}</span>}
                  <span>Statut : À confirmer</span>
                </p>
              </li>
            ))}
          </ul>
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

      {/* Catégorie revenus (P14.1 : UI interactive) */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-900">Catégorie revenus</h3>

        {categorieDeclaree && revenusMode === null ? (
          <div className="mt-1 text-sm">
            <p>
              Catégorie déclarée : <strong>{categorieDeclaree.replace("_", " ")}</strong>
            </p>
            <p className="mt-1 text-xs text-neutral-500">Source : Déclarée directement par le client (aucun calcul).</p>
            <button type="button" onClick={() => setCategorieDeclaree(null)} className="mt-1 text-xs text-neutral-500 underline">
              Modifier
            </button>
          </div>
        ) : categorieMenage?.categorie && revenusMode === null ? (
          <div className="mt-1 text-sm">
            <p>
              Catégorie estimée : <strong>{categorieMenage.categorie}</strong>
            </p>
            {categorieMenage.provenance && <p className="mt-1 text-xs text-neutral-500">Source : {categorieMenage.provenance}</p>}
          </div>
        ) : !aQuestionsRevenus ? (
          <p className="mt-1 text-sm text-neutral-500">Barème non configuré / à confirmer.</p>
        ) : revenusMode === null ? (
          <div className="mt-2">
            <p className="text-xs text-neutral-500">Connaissez-vous votre catégorie ?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIE_OPTIONS.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => declarerCategorie(code)}
                  disabled={pending}
                  className="rounded-lg border-2 border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  {code.replace("_", " ")}
                </button>
              ))}
              <button type="button" onClick={() => declarerCategorie("JE_NE_SAIS_PAS")} disabled className="rounded-lg border border-neutral-200 px-4 py-2 text-xs text-neutral-400">
                Je ne sais pas
              </button>
              <button
                type="button"
                onClick={() => setRevenusMode("calcul")}
                className="rounded-lg border-2 border-neutral-900 px-4 py-2 text-sm font-semibold"
              >
                Calculer à partir du RFR
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs text-neutral-500">
                Nombre de personnes
                <input
                  type="number"
                  min={1}
                  value={revenusForm.nombrePersonnes}
                  onChange={(e) => setRevenusForm((f) => ({ ...f, nombrePersonnes: e.target.value }))}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-500">
                RFR (€)
                <input
                  type="number"
                  min={0}
                  value={revenusForm.rfr}
                  onChange={(e) => setRevenusForm((f) => ({ ...f, rfr: e.target.value }))}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-500">
                Année de référence
                <input
                  type="number"
                  value={revenusForm.annee}
                  onChange={(e) => setRevenusForm((f) => ({ ...f, annee: e.target.value }))}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-500">
                Type occupant
                <select
                  value={revenusForm.typeOccupant}
                  onChange={(e) => setRevenusForm((f) => ({ ...f, typeOccupant: e.target.value }))}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                >
                  <option value="">—</option>
                  {TYPE_OCCUPANT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={calculerCategorie} disabled={pending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                Calculer la catégorie
              </button>
              <button type="button" onClick={() => setRevenusMode(null)} className="text-xs text-neutral-500 underline">
                Annuler
              </button>
            </div>

            {categorieMenage?.statut === "CALCULE" && categorieMenage.categorie && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <p>
                  Catégorie estimée : <strong>{categorieMenage.categorie}</strong>
                </p>
                {categorieMenage.provenance && <p className="mt-1 text-xs text-neutral-500">Source : {categorieMenage.provenance}</p>}
                <button type="button" onClick={confirmerCategorieCalculee} disabled={pending} className="mt-2 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                  Confirmer
                </button>
              </div>
            )}
            {categorieMenage?.statut === "BAREME_NON_CONFIGURE" && (
              <p className="text-sm text-neutral-500">Barème ANAH non configuré — catégorie à confirmer.</p>
            )}
            {categorieMenage?.statut === "DONNEES_INSUFFISANTES" && categorieMenage.missingFields && categorieMenage.missingFields.length > 0 && (
              <p className="text-sm text-amber-700">Informations manquantes : {categorieMenage.missingFields.join(", ")}</p>
            )}
          </div>
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
