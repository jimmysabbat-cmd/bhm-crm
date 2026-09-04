"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Lock, Unlock, FlaskConical, ShieldAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/money";
import { statutEligibiliteReglementaireLabels, scenarioRecommandationLabels } from "@/lib/dossier-labels";
import { evaluateVisibleQuestions, type QuestionDef, type AnswerValue, type TypeQuestionValue } from "@/lib/questionnaire/engine";
import { updateLead, claimLead, releaseClaim, recordInteraction, saveQuestionnaireAnswers, simulerEtudeLead, convertLeadToDossier } from "./lead-actions";
import { createRdv, updateRdvStatut } from "./rdv-actions";
import { acceptProposedValue, refuseProposedValue } from "./provenance-actions";
import type { RedactedStudyResult } from "@/lib/etude/redact";
import type { LeadQualificationResult } from "@/lib/leads/qualification";

// ============================================================
// Workspace d'appel (P9, section 6) - un seul écran, sections progressives
// A à H, pensé pour être rempli PENDANT un appel : peu de clics, gros
// champs, sauvegarde explicite section par section (pas d'auto-save
// silencieux qui masquerait les erreurs). Le questionnaire (B-E) est rendu
// GÉNÉRIQUEMENT à partir des données (evaluateVisibleQuestions), jamais une
// branche codée en dur par type de chauffage/projet.
// ============================================================

const SECTION_LABELS: Record<string, string> = {
  B_LOGEMENT: "B. Logement",
  C_CHAUFFAGE: "C. Chauffage actuel",
  D_TRAVAUX: "D. Travaux / besoins",
  E_ELIGIBILITE: "E. Éligibilité / données utiles",
};
const SECTION_ORDER = ["B_LOGEMENT", "C_CHAUFFAGE", "D_TRAVAUX", "E_ELIGIBILITE"];

type QuestionProp = {
  id: string;
  code: string;
  libelle: string;
  type: TypeQuestionValue;
  unite: string | null;
  obligatoire: boolean;
  section: string;
  options: { code: string; libelle: string }[];
  conditions: { questionDeclenchanteId: string; valeurAttendue: string }[];
};

type ReponseProp = { questionId: string; valeurTexte: string | null; valeurNombre: number | null; valeurBool: boolean | null; valeurOptions: string[] | null };

export function QualificationWorkspace(props: {
  lead: {
    id: string;
    prenom: string;
    nom: string;
    telephone: string | null;
    email: string | null;
    adresse: string | null;
    codePostal: string | null;
    ville: string | null;
    notes: string | null;
    temperature: "FROID" | "TIEDE" | "CHAUD";
    statutId: string;
    statutKey: string;
    sourceLabel: string | null;
    commercialNom: string | null;
    teleprospecteurNom: string | null;
    prochainContactAt: string | null;
    dossier: { id: string; reference: string } | null;
    claimedByMoi: boolean;
    claimActifAutre: boolean;
    claimedByNom: string | null;
  };
  logement:
    | ({
        id: string;
        typeBatiment: string | null;
        typeHabitat: string | null;
        anneeConstruction: number | null;
        surfaceHabitableM2: number | null;
        surfaceChauffeeM2: number | null;
        chauffagePrincipal: string | null;
      } & {
        champsProvenance: { id: string; champ: string; source: string; confiance: string; valeurProposee: string | null; sourceProposee: string | null; refusee: boolean }[];
      })
    | null;
  rdvs: { id: string; date: string; type: string; statut: string; adresse: string | null; commentaire: string | null }[];
  interactions: { id: string; type: string; resultatLabel: string | null; notes: string | null; dureeMinutes: number | null; createdAt: string; userNom: string | null }[];
  qualification: LeadQualificationResult;
  questionnaire: { versionId: string; questions: QuestionProp[] } | null;
  reponsesExistantes: ReponseProp[];
  statuts: { id: string; key: string; label: string }[];
  sources: { id: string; key: string; label: string }[];
  resultats: { id: string; key: string; label: string }[];
  users: { id: string; name: string }[];
  permissions: { peutModifier: boolean; peutSimulerEtude: boolean; peutVoirCoutsMarge: boolean };
}) {
  const { lead, logement, rdvs, interactions, qualification, questionnaire, reponsesExistantes, statuts, resultats, users, permissions } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [etudeResult, setEtudeResult] = useState<RedactedStudyResult | null>(null);
  const [dossierIdSimule, setDossierIdSimule] = useState<string | null>(lead.dossier?.id ?? null);

  const questionsById = useMemo(() => Object.fromEntries((questionnaire?.questions ?? []).map((q) => [q.id, q])), [questionnaire]);

  const [answersByCode, setAnswersByCode] = useState<Record<string, AnswerValue>>(() => {
    const initial: Record<string, AnswerValue> = {};
    for (const r of reponsesExistantes) {
      const q = questionsById[r.questionId];
      if (!q) continue;
      initial[q.code] = { texte: r.valeurTexte, nombre: r.valeurNombre, bool: r.valeurBool, options: r.valeurOptions };
    }
    return initial;
  });

  const questionDefs: (QuestionDef & { source: QuestionProp })[] = useMemo(
    () =>
      (questionnaire?.questions ?? []).map((q) => ({
        code: q.code,
        type: q.type,
        conditions: q.conditions.map((c) => ({ questionDeclenchanteCode: questionsById[c.questionDeclenchanteId]?.code ?? "", valeurAttendue: c.valeurAttendue })),
        source: q,
      })),
    [questionnaire, questionsById]
  );

  const visibleQuestions = useMemo(() => evaluateVisibleQuestions(questionDefs, answersByCode), [questionDefs, answersByCode]);
  const visibleBySection = useMemo(() => {
    const map: Record<string, QuestionProp[]> = {};
    for (const q of visibleQuestions) {
      (map[q.source.section] ??= []).push(q.source);
    }
    return map;
  }, [visibleQuestions]);

  function setAnswer(code: string, value: AnswerValue) {
    setAnswersByCode((prev) => ({ ...prev, [code]: value }));
  }

  function handleSaveContact(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await updateLead(lead.id, formData);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleSaveQuestionnaire() {
    if (!questionnaire) return;
    setError(null);
    const answers = visibleQuestions.map((q) => {
      const a = answersByCode[q.code] ?? {};
      return { questionId: q.source.id, valeurTexte: a.texte ?? null, valeurNombre: a.nombre ?? null, valeurBool: a.bool ?? null, valeurOptions: a.options ?? null };
    });
    startTransition(async () => {
      const r = await saveQuestionnaireAnswers(lead.id, questionnaire.versionId, answers);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleClaim() {
    setError(null);
    startTransition(async () => {
      const r = await claimLead(lead.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleReleaseClaim() {
    startTransition(async () => {
      await releaseClaim(lead.id);
      router.refresh();
    });
  }

  function handleRecordInteraction(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await recordInteraction(lead.id, formData);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleCreateRdv(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createRdv(lead.id, formData);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleSimuler() {
    setError(null);
    startTransition(async () => {
      const r = await simulerEtudeLead(lead.id);
      if (r.ok) {
        setEtudeResult(r.result);
        setDossierIdSimule(r.dossierId);
      } else setError(r.error);
    });
  }

  function handleConvertir() {
    setError(null);
    startTransition(async () => {
      const r = await convertLeadToDossier(lead.id);
      if (r.ok) router.push(`/dossiers/${r.dossierId}`);
      else setError(r.error);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-8">
      {/* En-tête + claim (section 23) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">{lead.sourceLabel ?? "Source inconnue"}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {lead.prenom} {lead.nom}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Phone className="h-3.5 w-3.5" /> {lead.telephone ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{statuts.find((s) => s.id === lead.statutId)?.label ?? lead.statutKey}</Badge>
          {qualification && <Badge color={qualification.statut === "SUFFISANT" ? "emerald" : qualification.statut === "PARTIEL" ? "amber" : "red"}>Qualif. {qualification.score}/100</Badge>}
          {lead.claimActifAutre ? (
            <Badge color="red">
              <Lock className="mr-1 h-3 w-3 inline" /> En appel ({lead.claimedByNom})
            </Badge>
          ) : lead.claimedByMoi ? (
            <Button type="button" variant="secondary" className="text-xs" onClick={handleReleaseClaim} disabled={isPending}>
              <Unlock className="h-3.5 w-3.5" /> Libérer
            </Button>
          ) : (
            <Button type="button" variant="secondary" className="text-xs" onClick={handleClaim} disabled={isPending}>
              <Lock className="h-3.5 w-3.5" /> Prendre l&apos;appel
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
      {qualification && (
        <p className="text-xs text-slate-400">
          Prochaine action recommandée : <strong>{qualification.recommendedNextAction}</strong>
        </p>
      )}

      {/* A. CONTACT */}
      <Card>
        <CardHeader>
          <CardTitle>A. Contact</CardTitle>
        </CardHeader>
        <form action={handleSaveContact} className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <div className="space-y-1">
            <label className={labelClass}>Prénom</label>
            <input name="prenom" defaultValue={lead.prenom} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" defaultValue={lead.nom} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="telephone" defaultValue={lead.telephone ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" defaultValue={lead.email ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className={labelClass}>Adresse</label>
            <input name="adresse" defaultValue={lead.adresse ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Code postal</label>
            <input name="codePostal" defaultValue={lead.codePostal ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Ville</label>
            <input name="ville" defaultValue={lead.ville ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Température</label>
            <select name="temperature" defaultValue={lead.temperature} className={inputClass} disabled={!permissions.peutModifier}>
              <option value="FROID">Froid</option>
              <option value="TIEDE">Tiède</option>
              <option value="CHAUD">Chaud</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Statut pipeline</label>
            <select name="statutKey" defaultValue={statuts.find((s) => s.id === lead.statutId)?.key} className={inputClass} disabled={!permissions.peutModifier}>
              {statuts.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-4">
            <label className={labelClass}>Notes</label>
            <input name="notes" defaultValue={lead.notes ?? ""} className={inputClass} disabled={!permissions.peutModifier} />
          </div>
          {permissions.peutModifier && (
            <div className="col-span-2 sm:col-span-4">
              <Button type="submit" variant="secondary" className="text-xs" disabled={isPending}>
                Enregistrer le contact
              </Button>
            </div>
          )}
        </form>
      </Card>

      {/* B-E. Questionnaire dynamique */}
      {questionnaire && (
        <Card>
          <CardHeader>
            <CardTitle>Logement, chauffage, travaux, éligibilité</CardTitle>
          </CardHeader>
          <div className="space-y-5 p-5">
            {SECTION_ORDER.filter((s) => visibleBySection[s]?.length).map((sectionKey) => (
              <div key={sectionKey} className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{SECTION_LABELS[sectionKey]}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {visibleBySection[sectionKey].map((q) => (
                    <QuestionInput key={q.id} question={q} value={answersByCode[q.code]} onChange={(v) => setAnswer(q.code, v)} disabled={!permissions.peutModifier} />
                  ))}
                </div>
              </div>
            ))}
            {permissions.peutModifier && (
              <Button type="button" variant="secondary" className="text-xs" onClick={handleSaveQuestionnaire} disabled={isPending}>
                Enregistrer les réponses
              </Button>
            )}

            {logement && logement.champsProvenance.some((c) => c.valeurProposee && !c.refusee) && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-amber-700">Données externes proposées (jamais appliquées automatiquement)</p>
                {logement.champsProvenance
                  .filter((c) => c.valeurProposee && !c.refusee)
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-2.5 text-xs">
                      <span>
                        <strong>{c.champ}</strong> : proposé « {c.valeurProposee} » (source {c.sourceProposee})
                      </span>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" className="text-xs" onClick={() => startTransition(async () => { await acceptProposedValue(c.id); router.refresh(); })} disabled={isPending}>
                          Accepter
                        </Button>
                        <Button type="button" variant="ghost" className="text-xs" onClick={() => startTransition(async () => { await refuseProposedValue(c.id); router.refresh(); })} disabled={isPending}>
                          Refuser
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* F. RDV */}
      <Card>
        <CardHeader>
          <CardTitle>F. RDV</CardTitle>
        </CardHeader>
        <div className="space-y-3 p-5">
          {rdvs.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 text-xs">
              <span>
                {new Date(r.date).toLocaleString("fr-FR")} · {r.type} · {r.adresse ?? "—"}
              </span>
              <div className="flex items-center gap-2">
                <Badge>{r.statut}</Badge>
                {permissions.peutModifier && r.statut !== "REALISE" && r.statut !== "ANNULE" && (
                  <Button type="button" variant="ghost" className="text-xs" onClick={() => startTransition(async () => { await updateRdvStatut(r.id, "REALISE"); router.refresh(); })} disabled={isPending}>
                    Marquer réalisé
                  </Button>
                )}
              </div>
            </div>
          ))}
          {permissions.peutModifier && (
            <form action={handleCreateRdv} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
              <input name="date" type="date" required className={smallInputClass} />
              <input name="heure" type="time" className={smallInputClass} />
              <select name="type" className={smallInputClass} defaultValue="VISITE">
                <option value="VISITE">Visite</option>
                <option value="TELEPHONIQUE">Téléphonique</option>
                <option value="AUTRE">Autre</option>
              </select>
              <select name="commercialId" className={smallInputClass} defaultValue="">
                <option value="">Commercial…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <input name="adresse" placeholder="Adresse" defaultValue={lead.adresse ?? ""} className={`col-span-2 ${smallInputClass}`} />
              <input name="commentaire" placeholder="Commentaire" className={`col-span-2 ${smallInputClass}`} />
              <Button type="submit" variant="secondary" className="text-xs">
                Planifier
              </Button>
            </form>
          )}
        </div>
      </Card>

      {/* G. RÉSULTAT DE L'APPEL + H. PROCHAINE ACTION */}
      <Card>
        <CardHeader>
          <CardTitle>G. Résultat de l&apos;appel / H. Prochaine action</CardTitle>
        </CardHeader>
        <div className="space-y-3 p-5">
          {permissions.peutModifier && (
            <form action={handleRecordInteraction} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select name="resultatKey" className={smallInputClass} defaultValue="">
                <option value="">Résultat…</option>
                {resultats.map((r) => (
                  <option key={r.id} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input name="dureeMinutes" type="number" placeholder="Durée (min)" className={smallInputClass} />
              <input name="prochaineActionAt" type="date" placeholder="Prochaine action" className={smallInputClass} />
              <select name="type" className={smallInputClass} defaultValue="APPEL">
                <option value="APPEL">Appel</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="VISITE">Visite</option>
                <option value="AUTRE">Autre</option>
              </select>
              <input name="notes" placeholder="Notes de l'appel" className={`col-span-2 ${smallInputClass} sm:col-span-3`} />
              <Button type="submit" variant="secondary" className="text-xs" disabled={isPending}>
                Enregistrer
              </Button>
            </form>
          )}
          <div className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {interactions.length === 0 && <p className="text-slate-400">Aucune interaction enregistrée.</p>}
            {interactions.map((i) => (
              <p key={i.id}>
                {new Date(i.createdAt).toLocaleString("fr-FR")} · {i.type} {i.resultatLabel ? `· ${i.resultatLabel}` : ""} {i.userNom ? `· ${i.userNom}` : ""} {i.notes ? `— ${i.notes}` : ""}
              </p>
            ))}
          </div>
        </div>
      </Card>

      {/* Intégration P8 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-600" />
            <CardTitle>Étude (P8)</CardTitle>
          </div>
          {permissions.peutSimulerEtude && (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="text-xs" onClick={handleSimuler} disabled={isPending}>
                Simuler l&apos;étude
              </Button>
              <Button type="button" className="text-xs" onClick={handleConvertir} disabled={isPending}>
                Convertir en dossier
              </Button>
            </div>
          )}
        </CardHeader>
        <div className="space-y-3 p-5 text-sm">
          {lead.dossier || dossierIdSimule ? (
            <p className="text-xs text-slate-500">
              Dossier lié :{" "}
              <a href={`/dossiers/${lead.dossier?.id ?? dossierIdSimule}`} className="font-medium text-emerald-700 hover:underline">
                {lead.dossier?.reference ?? "voir le dossier"}
              </a>
            </p>
          ) : (
            <p className="text-xs text-slate-400">Aucun dossier créé pour l&apos;instant - « Simuler l&apos;étude » en créera un brouillon automatiquement.</p>
          )}

          {etudeResult && (
            <div className="space-y-2">
              <p className="text-xs italic text-slate-400">{etudeResult.recommendedScenarioLabel}</p>
              {etudeResult.context.missingFields.length > 0 && (
                <p className="text-xs text-amber-700">Données manquantes : {etudeResult.context.missingFields.join(", ")}</p>
              )}
              {etudeResult.scenarios.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs">
                  <p className="font-medium text-slate-800">{s.titre}</p>
                  <p className="text-slate-500">
                    {s.statutEligibilite ? statutEligibiliteReglementaireLabels[s.statutEligibilite] : "—"} · CEE {s.ceeKwhCumac?.toLocaleString("fr-FR") ?? "—"} kWh cumac · Reste à charge{" "}
                    {s.resteAChargeClientCts != null ? formatCents(s.resteAChargeClientCts) : "non déterminable"}
                  </p>
                  {permissions.peutVoirCoutsMarge && s.margin && (
                    <p className="text-slate-500">
                      Marge : {s.margin.confidence === "NON_CALCULABLE" ? "non calculable" : `${formatCents(s.margin.margeCts)} (${s.margin.margePct?.toFixed(0)} %)`}
                    </p>
                  )}
                  {s.fichesReglementaires.some((f) => f.confianceSource === "UNVERIFIED_SOURCE") && (
                    <p className="mt-1 flex items-center gap-1 font-medium text-amber-700">
                      <ShieldAlert className="h-3 w-3" /> Source réglementaire non vérifiée.
                    </p>
                  )}
                  <p className="mt-1">
                    <Badge>{scenarioRecommandationLabels[s.recommandation]}</Badge>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function QuestionInput({ question, value, onChange, disabled }: { question: QuestionProp; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void; disabled: boolean }) {
  const label = `${question.libelle}${question.unite ? ` (${question.unite})` : ""}${question.obligatoire ? " *" : ""}`;
  switch (question.type) {
    case "YES_NO":
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <select className={smallInputClass} value={value?.bool == null ? "" : value.bool ? "true" : "false"} onChange={(e) => onChange({ bool: e.target.value === "" ? null : e.target.value === "true" })} disabled={disabled}>
            <option value="">—</option>
            <option value="true">Oui</option>
            <option value="false">Non</option>
          </select>
        </div>
      );
    case "NUMBER":
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <input type="number" step="0.01" className={smallInputClass} value={value?.nombre ?? ""} onChange={(e) => onChange({ nombre: e.target.value === "" ? null : Number(e.target.value) })} disabled={disabled} />
        </div>
      );
    case "DATE":
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <input type="date" className={smallInputClass} value={value?.date ?? ""} onChange={(e) => onChange({ date: e.target.value || null })} disabled={disabled} />
        </div>
      );
    case "SINGLE_SELECT":
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <select className={smallInputClass} value={value?.options?.[0] ?? ""} onChange={(e) => onChange({ options: e.target.value ? [e.target.value] : null })} disabled={disabled}>
            <option value="">—</option>
            {question.options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.libelle}
              </option>
            ))}
          </select>
        </div>
      );
    case "MULTI_SELECT":
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <select
            multiple
            className={smallInputClass}
            value={value?.options ?? []}
            onChange={(e) => onChange({ options: Array.from(e.target.selectedOptions).map((o) => o.value) })}
            disabled={disabled}
          >
            {question.options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.libelle}
              </option>
            ))}
          </select>
        </div>
      );
    default:
      return (
        <div className="space-y-1">
          <label className={labelClass}>{label}</label>
          <input type="text" className={smallInputClass} value={value?.texte ?? ""} onChange={(e) => onChange({ texte: e.target.value || null })} disabled={disabled} />
        </div>
      );
  }
}
