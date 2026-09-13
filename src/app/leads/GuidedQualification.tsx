"use client";

import { useMemo, useState, useTransition } from "react";
import { calculerOpportunitesPourLead, getNextBestQuestionPourLead, confirmerRdvQualification, getArgumentairePourOpportunite } from "./qualification-actions";
import { saveQuestionnaireAnswers, recordInteraction, type QuestionnaireAnswerInput } from "./lead-actions";
import { RevenusBlock, type CategorieMenageVm } from "./RevenusBlock";
import { EnrichissementBlock } from "./EnrichissementBlock";
import type { OpportuniteDetectee } from "@/lib/opportunites/types";
import type { ArgumentaireBlocs } from "@/lib/opportunites/argumentaire";

// ============================================================
// P14.2 (audit sections 2-19) - vue plein écran "une question à la fois"
// du parcours de qualification télépro. Couche de PRÉSENTATION uniquement :
// orchestre les moteurs déjà existants (Next Best Question, Moteur
// Opportunités, ChampProvenance, EtudeDossier via conversion) sans en
// dupliquer aucun. Coexiste avec QualificationWorkspace (vue détaillée,
// jamais modifiée) - un simple bouton bascule entre les deux (page.tsx).
// ============================================================

type QuestionOption = { code: string; libelle: string };
type QuestionFull = {
  id: string;
  code: string;
  libelle: string;
  type: string;
  unite: string | null;
  obligatoire: boolean;
  section: string | null;
  options: QuestionOption[];
};
type NbqQuestionVm = { id: string; code: string; libelle: string; type: string; obligatoire: boolean; categorieImpact: string | null };
type ReponseExistante = { questionId: string; valeurTexte: string | null; valeurNombre: number | null; valeurBool: boolean | null; valeurOptions: string[] | null };

const NIVEAU_STYLE: Record<string, string> = {
  FORTE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  A_ETUDIER: "bg-amber-100 text-amber-800 border-amber-300",
  FAIBLE: "bg-neutral-100 text-neutral-600 border-neutral-300",
  NON_PERTINENT: "bg-neutral-50 text-neutral-400 border-neutral-200",
};

export function GuidedQualification({
  lead,
  questionnaireVersionId,
  questions,
  reponsesExistantes,
  logementConnu,
  initialOpportunites,
  initialNbq,
  initialCategorieMenage,
  initialCategorieDeclaree,
  revenusQuestions,
  resultats,
  aDejaRdv,
  peutModifier,
}: {
  lead: { id: string; prenom: string; nom: string; telephone: string | null; adresse: string | null; commercialNom: string | null; teleprospecteurNom: string | null };
  questionnaireVersionId: string | null;
  questions: QuestionFull[];
  reponsesExistantes: ReponseExistante[];
  logementConnu: boolean;
  initialOpportunites: OpportuniteDetectee[];
  initialNbq: { question: NbqQuestionVm | null; reasons: string[] } | null;
  initialCategorieMenage: CategorieMenageVm | null;
  initialCategorieDeclaree: string | null;
  revenusQuestions: Record<string, string>;
  resultats: { id: string; key: string; label: string }[];
  aDejaRdv: boolean;
  peutModifier: boolean;
}) {
  const [opportunites, setOpportunites] = useState(initialOpportunites);
  const [nbq, setNbq] = useState(initialNbq);
  const [categorieConnue, setCategorieConnue] = useState<boolean>(!!initialCategorieDeclaree || !!initialCategorieMenage?.categorie);
  const [besoinConnu, setBesoinConnu] = useState<boolean>(reponsesExistantes.some((r) => questions.find((q) => q.id === r.questionId)?.code === "BESOIN_PRINCIPAL"));
  const [rdvCree, setRdvCree] = useState(aDejaRdv);
  const [vue, setVue] = useState<"question" | "synthese">("question");
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rdvForm, setRdvForm] = useState({ date: "", heure: "14:00", commentaire: "" });
  const [rdvMessage, setRdvMessage] = useState<string | null>(null);
  const [multiSelectDraft, setMultiSelectDraft] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState("");
  const [numberDraft, setNumberDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [argumentaireOuvert, setArgumentaireOuvert] = useState<string | null>(null);
  const [argumentaire, setArgumentaire] = useState<ArgumentaireBlocs | null>(null);
  const [pending, startTransition] = useTransition();

  const questionActive = useMemo(() => (nbq?.question ? questions.find((q) => q.id === nbq.question!.id) : null), [nbq, questions]);

  function refresh() {
    startTransition(async () => {
      const [opRes, nbqRes] = await Promise.all([calculerOpportunitesPourLead(lead.id), getNextBestQuestionPourLead(lead.id)]);
      if (opRes.ok) setOpportunites(opRes.result.opportunites);
      if (nbqRes.ok) setNbq(nbqRes.result);
    });
  }

  function envoyerReponse(answer: Omit<QuestionnaireAnswerInput, "questionId">) {
    if (!questionActive || !questionnaireVersionId) return;
    const id = questionActive.id;
    startTransition(async () => {
      const res = await saveQuestionnaireAnswers(lead.id, questionnaireVersionId, [{ questionId: id, ...answer }]);
      // BUG P14.2 corrigé : la réponse était silencieusement perdue (aucune
      // erreur affichée, aucune ligne enregistrée) si saveQuestionnaireAnswers
      // renvoyait { ok: false } (ex. session platform admin dont le tenant
      // actif a expiré) - le retour de l'action n'était jamais vérifié.
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setSaveError(null);
      if (questionActive.code === "BESOIN_PRINCIPAL") setBesoinConnu(true);
      setMultiSelectDraft([]);
      setTextDraft("");
      setNumberDraft("");
      setDateDraft("");
      refresh();
    });
  }

  function repondreInconnu(sentinel: "INCONNU" | "A_VERIFIER_VISITE") {
    envoyerReponse({ valeurOptions: [sentinel] });
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
      const res = await getArgumentairePourOpportunite(lead.id, ficheMetierId);
      if (res.ok) setArgumentaire(res.result);
    });
  }

  function actionAppel(resultatKey: string, libelle: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("resultatKey", resultatKey);
      fd.set("type", "APPEL");
      const res = await recordInteraction(lead.id, fd);
      setCallMessage(res.ok ? `Enregistré : ${libelle}.` : res.error);
    });
  }

  function confirmerRdv() {
    if (!rdvForm.date) {
      setRdvMessage("Date obligatoire.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("date", rdvForm.date);
      fd.set("heure", rdvForm.heure);
      fd.set("type", "VISITE");
      fd.set("commentaire", rdvForm.commentaire);
      const res = await confirmerRdvQualification(lead.id, fd);
      if (res.ok) {
        setRdvCree(true);
        setRdvMessage("RDV confirmé - opportunités figées, fiche prête pour le commercial.");
      } else {
        setRdvMessage(res.error);
      }
    });
  }

  // Progression réelle (audit section 3) - jamais un pourcentage arbitraire.
  const progression: { label: string; done: boolean }[] = [
    { label: "Client", done: !!lead.telephone && !!lead.adresse },
    { label: "Logement", done: logementConnu },
    { label: "Revenus", done: categorieConnue },
    { label: "Projet", done: besoinConnu },
    { label: "Technique", done: !nbq?.question },
    { label: "RDV", done: rdvCree },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pb-8 sm:px-8">
      {/* Header appel - toujours visible (audit section 4) */}
      <header className="sticky top-0 z-10 rounded-lg border border-neutral-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              {lead.prenom} {lead.nom}
            </p>
            <p className="text-xs text-neutral-500">
              {lead.telephone ? (
                <a href={`tel:${lead.telephone}`} className="underline">
                  {lead.telephone}
                </a>
              ) : (
                "Téléphone inconnu"
              )}
              {lead.adresse ? ` · ${lead.adresse}` : ""}
            </p>
            {(lead.commercialNom || lead.teleprospecteurNom) && (
              <p className="text-xs text-neutral-400">
                {lead.teleprospecteurNom ? `Télépro : ${lead.teleprospecteurNom}` : ""}
                {lead.commercialNom ? ` · Commercial : ${lead.commercialNom}` : ""}
              </p>
            )}
          </div>
          {peutModifier && (
            <div className="flex flex-wrap gap-1.5">
              {resultats.find((r) => r.key === "A_RAPPELER") && (
                <button type="button" onClick={() => actionAppel("A_RAPPELER", "à rappeler")} disabled={pending} className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40">
                  Rappeler plus tard
                </button>
              )}
              {resultats.find((r) => r.key === "INJOIGNABLE") && (
                <button type="button" onClick={() => actionAppel("INJOIGNABLE", "absent / injoignable")} disabled={pending} className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40">
                  Absent
                </button>
              )}
              {resultats.find((r) => r.key === "PAS_INTERESSE") && (
                <button type="button" onClick={() => actionAppel("PAS_INTERESSE", "pas intéressé")} disabled={pending} className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40">
                  Pas intéressé
                </button>
              )}
              <button type="button" onClick={() => setVue("question")} className="rounded border-2 border-neutral-900 px-2 py-1 text-xs font-semibold">
                Continuer
              </button>
            </div>
          )}
        </div>
        {callMessage && <p className="mt-1 text-xs text-emerald-700">{callMessage}</p>}
      </header>

      {/* Progression réelle */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs">
        {progression.map((p) => (
          <span key={p.label} className={p.done ? "text-emerald-700" : "text-neutral-400"}>
            {p.label} {p.done ? "✓" : "○"}
          </span>
        ))}
      </div>

      {vue === "synthese" ? (
        <SyntheseEcran
          lead={lead}
          opportunites={opportunites}
          categorieConnue={categorieConnue}
          initialCategorieMenage={initialCategorieMenage}
          initialCategorieDeclaree={initialCategorieDeclaree}
          rdvForm={rdvForm}
          setRdvForm={setRdvForm}
          confirmerRdv={confirmerRdv}
          rdvMessage={rdvMessage}
          pending={pending}
          rdvCree={rdvCree}
          onRetour={() => setVue("question")}
        />
      ) : (
        <>
          {/* Enrichissement + revenus restent accessibles mais discrets (pas le focus principal de l'écran guidé) */}
          <details className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-medium text-neutral-700">Enrichissement automatique (adresse / DPE)</summary>
            <div className="mt-2">
              <EnrichissementBlock leadId={lead.id} hasAdresse={!!lead.adresse} onChanged={refresh} />
            </div>
          </details>

          <details className="rounded-lg border border-neutral-200 bg-white p-3 text-sm" open={!categorieConnue}>
            <summary className="cursor-pointer font-medium text-neutral-700">Foyer / revenus</summary>
            <div className="mt-2">
              <RevenusBlock
                leadId={lead.id}
                questionnaireVersionId={questionnaireVersionId}
                initialCategorieMenage={initialCategorieMenage}
                initialCategorieDeclaree={initialCategorieDeclaree}
                revenusQuestions={revenusQuestions}
                onChanged={() => {
                  setCategorieConnue(true);
                  refresh();
                }}
              />
            </div>
          </details>

          {/* Question principale - une seule à la fois (audit section 2/11) */}
          {questionActive ? (
            <section className="rounded-lg border-2 border-neutral-900 bg-white p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Question principale</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">{questionActive.libelle}</p>
              {saveError && <p className="mt-1 text-xs font-medium text-red-600">Réponse non enregistrée : {saveError}</p>}

              <div className="mt-4 flex flex-wrap gap-2">
                {questionActive.type === "YES_NO" && (
                  <>
                    <button type="button" onClick={() => envoyerReponse({ valeurBool: true })} className="rounded-lg border-2 border-neutral-900 px-6 py-3 text-sm font-semibold">
                      OUI
                    </button>
                    <button type="button" onClick={() => envoyerReponse({ valeurBool: false })} className="rounded-lg border-2 border-neutral-300 px-6 py-3 text-sm font-semibold">
                      NON
                    </button>
                  </>
                )}

                {questionActive.type === "SINGLE_SELECT" &&
                  questionActive.options.map((o) => (
                    <button key={o.code} type="button" onClick={() => envoyerReponse({ valeurOptions: [o.code] })} className="rounded-lg border-2 border-neutral-300 px-4 py-3 text-sm font-medium hover:border-neutral-900">
                      {o.libelle}
                    </button>
                  ))}

                {questionActive.type === "MULTI_SELECT" && (
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {questionActive.options.map((o) => {
                        const selected = multiSelectDraft.includes(o.code);
                        return (
                          <button
                            key={o.code}
                            type="button"
                            onClick={() => setMultiSelectDraft((prev) => (selected ? prev.filter((c) => c !== o.code) : [...prev, o.code]))}
                            className={`rounded-lg border-2 px-4 py-2 text-sm font-medium ${selected ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
                          >
                            {o.libelle}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => envoyerReponse({ valeurOptions: multiSelectDraft })}
                      disabled={multiSelectDraft.length === 0}
                      className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
                    >
                      Valider ({multiSelectDraft.length})
                    </button>
                  </div>
                )}

                {questionActive.type === "NUMBER" && (
                  <div className="flex items-center gap-2">
                    <input type="number" value={numberDraft} onChange={(e) => setNumberDraft(e.target.value)} className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm" placeholder={questionActive.unite ?? ""} />
                    <button type="button" onClick={() => envoyerReponse({ valeurNombre: Number(numberDraft) })} disabled={numberDraft === ""} className="rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
                      Valider
                    </button>
                  </div>
                )}

                {questionActive.type === "TEXT" && (
                  <div className="flex w-full flex-col gap-2">
                    <textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" rows={2} />
                    <button type="button" onClick={() => envoyerReponse({ valeurTexte: textDraft })} disabled={!textDraft} className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
                      Valider
                    </button>
                  </div>
                )}

                {questionActive.type === "DATE" && (
                  <div className="flex items-center gap-2">
                    <input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} className="rounded border border-neutral-300 px-3 py-2 text-sm" />
                    <button type="button" onClick={() => envoyerReponse({ valeurDate: dateDraft })} disabled={!dateDraft} className="rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
                      Valider
                    </button>
                  </div>
                )}
              </div>

              {/* Jamais forcer une réponse inventée (audit section 11) */}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                <button type="button" onClick={() => repondreInconnu("INCONNU")} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                  Je ne sais pas
                </button>
                <button type="button" onClick={() => repondreInconnu("A_VERIFIER_VISITE")} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                  À vérifier en visite
                </button>
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
              <p className="text-sm text-neutral-500">Plus aucune question applicable pour le moment.</p>
              <button type="button" onClick={() => setVue("synthese")} className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                Voir la synthèse
              </button>
            </section>
          )}

          {/* Opportunités en direct (audit section 9) */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-neutral-900">Opportunités en direct</h3>
            {opportunites.length === 0 && <p className="mt-1 text-sm text-neutral-400">Aucune fiche métier active configurée pour ce tenant.</p>}
            <ul className="mt-2 space-y-2">
              {opportunites.map((o) => (
                <li key={o.ficheMetierId} className={`rounded-md border px-3 py-2 ${NIVEAU_STYLE[o.niveau] ?? ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.libelle}</span>
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      {o.niveau.replace("_", " ")}
                      <button type="button" onClick={() => toggleArgumentaire(o.ficheMetierId)} className="rounded border border-current px-2 py-0.5 text-[11px] font-normal">
                        {argumentaireOuvert === o.ficheMetierId ? "Masquer" : "Pourquoi ?"}
                      </button>
                    </span>
                  </div>
                  {o.raisonsPositives.length > 0 && <p className="mt-1 text-xs">+ {o.raisonsPositives.join(" · ")}</p>}
                  {o.informationsManquantes.length > 0 && <p className="mt-1 text-xs opacity-70">Manque : {o.informationsManquantes.join(", ")}</p>}
                  {argumentaireOuvert === o.ficheMetierId && argumentaire && (
                    <div className="mt-2 space-y-1 rounded-md border border-white/60 bg-white/70 p-2 text-xs text-neutral-800">
                      {argumentaire.pourquoi && <p>{argumentaire.pourquoi}</p>}
                      {argumentaire.benefices && (
                        <p>
                          <strong>Bénéfices :</strong> {argumentaire.benefices}
                        </p>
                      )}
                      <p>
                        <strong>Aides :</strong> {argumentaire.aides}
                      </p>
                      {argumentaire.prochaineEtape && (
                        <p>
                          <strong>Prochaine étape :</strong> {argumentaire.prochaineEtape}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {opportunites.length > 0 && (
              <button type="button" onClick={() => setVue("synthese")} className="mt-3 text-xs text-neutral-500 underline">
                Voir la synthèse / prendre RDV
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SyntheseEcran({
  lead,
  opportunites,
  categorieConnue,
  initialCategorieMenage,
  initialCategorieDeclaree,
  rdvForm,
  setRdvForm,
  confirmerRdv,
  rdvMessage,
  pending,
  rdvCree,
  onRetour,
}: {
  lead: { prenom: string; nom: string; adresse: string | null };
  opportunites: OpportuniteDetectee[];
  categorieConnue: boolean;
  initialCategorieMenage: CategorieMenageVm | null;
  initialCategorieDeclaree: string | null;
  rdvForm: { date: string; heure: string; commentaire: string };
  setRdvForm: (v: { date: string; heure: string; commentaire: string }) => void;
  confirmerRdv: () => void;
  rdvMessage: string | null;
  pending: boolean;
  rdvCree: boolean;
  onRetour: () => void;
}) {
  const categorieAffichee = initialCategorieDeclaree ?? initialCategorieMenage?.categorie ?? null;
  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Qualification — synthèse</p>

      <div>
        <p className="text-sm font-semibold">
          {lead.prenom} {lead.nom}
        </p>
        {lead.adresse && <p className="text-xs text-neutral-500">{lead.adresse}</p>}
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500">Revenus</p>
        <p className="text-sm">{categorieConnue && categorieAffichee ? categorieAffichee.replace(/_/g, " ") : "À confirmer — barème/donnée non renseignée."}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500">Opportunités</p>
        {opportunites.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune détectée pour le moment.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {opportunites.map((o) => (
              <li key={o.ficheMetierId}>
                {o.libelle} — <span className="font-medium">{o.niveau.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500">Aides</p>
        {/* Formulations toujours prudentes (audit section 12) - jamais un montant affirmé. */}
        <p className="text-sm text-neutral-600">Potentielles — à confirmer selon éligibilité réglementaire (P7) et scénario (P8).</p>
      </div>

      {!rdvCree ? (
        <div className="border-t border-neutral-100 pt-4">
          <p className="text-xs font-medium text-neutral-500">Prendre un RDV</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="date" value={rdvForm.date} onChange={(e) => setRdvForm({ ...rdvForm, date: e.target.value })} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
            <input type="time" value={rdvForm.heure} onChange={(e) => setRdvForm({ ...rdvForm, heure: e.target.value })} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
            <input
              type="text"
              placeholder="Commentaire (optionnel)"
              value={rdvForm.commentaire}
              onChange={(e) => setRdvForm({ ...rdvForm, commentaire: e.target.value })}
              className="min-w-[10rem] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <button type="button" onClick={confirmerRdv} disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Confirmer le RDV
            </button>
          </div>
          {rdvMessage && <p className="mt-2 text-xs text-neutral-500">{rdvMessage}</p>}
        </div>
      ) : (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">RDV confirmé - fiche prête pour la transmission au commercial.</p>
      )}

      <button type="button" onClick={onRetour} className="text-xs text-neutral-500 underline">
        Retour à la qualification
      </button>
    </section>
  );
}
