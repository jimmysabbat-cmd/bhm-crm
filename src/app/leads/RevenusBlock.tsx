"use client";

import { useState, useTransition } from "react";
import { getCategorieMenagePourLead } from "./qualification-actions";
import { saveQuestionnaireAnswers, type QuestionnaireAnswerInput } from "./lead-actions";

// ============================================================
// Bloc revenus/foyer (P14.1, extrait en composant partagé pour P14.2 -
// utilisé à la fois par OpportunitesPanel (vue détaillée) et
// GuidedQualification (vue guidée plein écran), UNE seule logique, jamais
// dupliquée). Distingue toujours DÉCLARÉ / CALCULÉ+CONFIRMÉ / non configuré
// - jamais une catégorie inventée.
// ============================================================

export type CategorieMenageVm = { statut: string; categorie: string | null; reasons: string[]; missingFields?: string[]; provenance?: string | null };

const CATEGORIE_OPTIONS = ["TRES_MODESTE", "MODESTE", "INTERMEDIAIRE", "SUPERIEUR"] as const;
const TYPE_OCCUPANT_OPTIONS = ["PROPRIETAIRE", "LOCATAIRE", "BAILLEUR"] as const;

export function RevenusBlock({
  leadId,
  questionnaireVersionId,
  initialCategorieMenage,
  initialCategorieDeclaree,
  revenusQuestions,
  onChanged,
}: {
  leadId: string;
  questionnaireVersionId: string | null;
  initialCategorieMenage: CategorieMenageVm | null;
  initialCategorieDeclaree: string | null;
  revenusQuestions: Record<string, string>;
  /** Appelé après toute écriture (déclaration, calcul confirmé) - permet à l'appelant de rafraîchir opportunités/NBQ. */
  onChanged?: () => void;
}) {
  const [categorieMenage, setCategorieMenage] = useState<CategorieMenageVm | null>(initialCategorieMenage);
  const [categorieDeclaree, setCategorieDeclaree] = useState<string | null>(initialCategorieDeclaree);
  const [revenusMode, setRevenusMode] = useState<"choix" | "calcul" | null>(null);
  const [revenusForm, setRevenusForm] = useState({ nombrePersonnes: "", rfr: "", annee: "", typeOccupant: "" });
  const [pending, startTransition] = useTransition();

  const aQuestionsRevenus = Object.keys(revenusQuestions).length > 0;

  function declarerCategorie(code: string) {
    const questionId = revenusQuestions.CATEGORIE_REVENUS_DECLAREE;
    if (!questionId || !questionnaireVersionId) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, [{ questionId, valeurOptions: [code] }]);
      setCategorieDeclaree(code);
      setRevenusMode(null);
      onChanged?.();
    });
  }

  function calculerCategorie() {
    if (!questionnaireVersionId) return;
    const answers: QuestionnaireAnswerInput[] = [];
    if (revenusQuestions.NOMBRE_PERSONNES_FOYER && revenusForm.nombrePersonnes) answers.push({ questionId: revenusQuestions.NOMBRE_PERSONNES_FOYER, valeurNombre: Number(revenusForm.nombrePersonnes) });
    if (revenusQuestions.REVENU_FISCAL_REFERENCE && revenusForm.rfr) answers.push({ questionId: revenusQuestions.REVENU_FISCAL_REFERENCE, valeurNombre: Number(revenusForm.rfr) });
    if (revenusQuestions.ANNEE_REFERENCE_REVENU && revenusForm.annee) answers.push({ questionId: revenusQuestions.ANNEE_REFERENCE_REVENU, valeurNombre: Number(revenusForm.annee) });
    if (revenusQuestions.TYPE_OCCUPANT && revenusForm.typeOccupant) answers.push({ questionId: revenusQuestions.TYPE_OCCUPANT, valeurOptions: [revenusForm.typeOccupant] });
    if (answers.length === 0) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, answers);
      const res = await getCategorieMenagePourLead(leadId);
      if (res.ok) setCategorieMenage(res.result);
      onChanged?.();
    });
  }

  function confirmerCategorieCalculee() {
    const questionId = revenusQuestions.CATEGORIE_REVENUS_CALCULEE;
    if (!questionId || !questionnaireVersionId || !categorieMenage?.categorie) return;
    startTransition(async () => {
      await saveQuestionnaireAnswers(leadId, questionnaireVersionId, [{ questionId, valeurOptions: [categorieMenage.categorie!] }]);
      setRevenusMode(null);
      onChanged?.();
    });
  }

  return (
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
              <button key={code} type="button" onClick={() => declarerCategorie(code)} disabled={pending} className="rounded-lg border-2 border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40">
                {code.replace("_", " ")}
              </button>
            ))}
            <button type="button" onClick={() => declarerCategorie("JE_NE_SAIS_PAS")} disabled className="rounded-lg border border-neutral-200 px-4 py-2 text-xs text-neutral-400">
              Je ne sais pas
            </button>
            <button type="button" onClick={() => setRevenusMode("calcul")} className="rounded-lg border-2 border-neutral-900 px-4 py-2 text-sm font-semibold">
              Calculer à partir du RFR
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-neutral-500">
              Nombre de personnes
              <input type="number" min={1} value={revenusForm.nombrePersonnes} onChange={(e) => setRevenusForm((f) => ({ ...f, nombrePersonnes: e.target.value }))} className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-neutral-500">
              RFR (€)
              <input type="number" min={0} value={revenusForm.rfr} onChange={(e) => setRevenusForm((f) => ({ ...f, rfr: e.target.value }))} className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-neutral-500">
              Année de référence
              <input type="number" value={revenusForm.annee} onChange={(e) => setRevenusForm((f) => ({ ...f, annee: e.target.value }))} className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-neutral-500">
              Type occupant
              <select value={revenusForm.typeOccupant} onChange={(e) => setRevenusForm((f) => ({ ...f, typeOccupant: e.target.value }))} className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm">
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
          {categorieMenage?.statut === "BAREME_NON_CONFIGURE" && <p className="text-sm text-neutral-500">Barème ANAH non configuré — catégorie à confirmer.</p>}
          {categorieMenage?.statut === "DONNEES_INSUFFISANTES" && categorieMenage.missingFields && categorieMenage.missingFields.length > 0 && (
            <p className="text-sm text-amber-700">Informations manquantes : {categorieMenage.missingFields.join(", ")}</p>
          )}
        </div>
      )}
    </section>
  );
}
