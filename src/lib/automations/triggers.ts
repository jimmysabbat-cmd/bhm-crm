import { prisma } from "@/lib/prisma";
import { mouvementIsLate } from "@/lib/finance";
import { getMissingDocumentsRelanceData } from "@/lib/documents/relance";
import { getDocumentChecklistForDossier } from "@/lib/documents/checklist";
import { evaluateTransmissionReadiness } from "@/lib/documents/transmission";
import { buildStudyContext, isStudyStale } from "@/lib/etude/engine";
import { isDocumentExpired } from "@/lib/documents/expiration";
import type { AutomationRuleData, TriggerMatch } from "./types";
import type { DestinationTransmission } from "@/generated/prisma/enums";

// ============================================================
// Détection des déclencheurs (P11, section 2) - une fonction par
// triggerType, toutes en LECTURE SEULE, réutilisant systématiquement les
// moteurs existants (P5-P10) plutôt que de recalculer une décision métier.
// Chaque match porte une triggerKey stable qui, combinée à l'engine
// (AutomationExecution), garantit l'idempotence (section 4).
// ============================================================

type Rule = Pick<AutomationRuleData, "organisationId" | "triggerConfig" | "delayJours" | "delayMinutes">;

function cfgString(cfg: Record<string, unknown> | null, key: string): string | undefined {
  const v = cfg?.[key];
  return typeof v === "string" ? v : undefined;
}
function cfgNumber(cfg: Record<string, unknown> | null, key: string): number | undefined {
  const v = cfg?.[key];
  return typeof v === "number" ? v : undefined;
}

// --- DOCUMENT_MISSING : cadence J0/J+3/J+7/J+14 pilotée par plusieurs
// règles (une par "pas", stepIndex dans triggerConfig) - la source de
// vérité de la cadence est l'historique des relances déjà envoyées
// (getMissingDocumentsRelanceData, section 9 : "ne crée pas un deuxième
// moteur concurrent").
export async function detectDocumentMissing(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, statut: { key: { not: "CLOTURE" } } },
    select: { id: true, createdAt: true },
  });

  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    const relance = await getMissingDocumentsRelanceData(d.id, rule.organisationId);
    if (relance.documentsManquants.length === 0) continue;
    // Cette règle correspond au "pas" stepIndex : n'agit que si le dossier
    // en est exactement à ce stade (nombre de relances déjà envoyées).
    if (relance.relanceCount !== stepIndex) continue;

    const anchor = relance.lastRelanceAt ?? d.createdAt;
    const joursDepuis = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
    const delaiRequis = rule.delayJours ?? 0;
    if (joursDepuis < delaiRequis) continue;

    matches.push({
      entityType: "Dossier",
      entityId: d.id,
      triggerKey: `step-${stepIndex}`,
      context: { dossierId: d.id, documentsManquants: relance.documentsManquants, relanceCount: relance.relanceCount },
    });
  }
  return matches;
}

// --- DOCUMENT_REJECTED : un document REFUSE précis, une fois par document
// (jamais retraité après idempotence, même si toujours REFUSE au tour
// suivant).
export async function detectDocumentRejected(rule: Rule): Promise<TriggerMatch[]> {
  const docs = await prisma.dossierDocument.findMany({
    where: { organisationId: rule.organisationId, statut: "REFUSE" },
    select: { id: true, dossierId: true, rejectionReason: true, typeDocumentRef: { select: { nom: true } } },
  });
  return docs.map((d) => ({
    entityType: "DossierDocument",
    entityId: d.id,
    triggerKey: "rejected",
    context: { dossierId: d.dossierId, documentId: d.id, motif: d.rejectionReason, typeDocumentNom: d.typeDocumentRef?.nom ?? null },
  }));
}

// --- DOCUMENT_EXPIRED : un document VALIDE dont dateExpiration est dépassée
// (calcul dynamique, jamais un statut stocké - cf. P10 section 7).
export async function detectDocumentExpired(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const docs = await prisma.dossierDocument.findMany({
    where: { organisationId: rule.organisationId, statut: "VALIDE", dateExpiration: { not: null } },
    select: { id: true, dossierId: true, dateExpiration: true, typeDocumentRef: { select: { nom: true } } },
  });
  return docs
    .filter((d) => isDocumentExpired(d, now))
    .map((d) => ({
      entityType: "DossierDocument",
      entityId: d.id,
      triggerKey: "expired",
      context: { dossierId: d.dossierId, documentId: d.id, typeDocumentNom: d.typeDocumentRef?.nom ?? null },
    }));
}

// --- TRANSMISSION_READY / CEE_READY : reprend evaluateTransmissionReadiness
// (P10) - jamais une seconde logique de calcul de disponibilité. triggerKey
// = "ready" (idempotent une fois par dossier/destination ; un futur cycle
// manquant->prêt->manquant->prêt ne relancera pas une seconde fois, un
// choix assumé pour rester simple et déterministe).
export async function detectTransmissionReady(rule: Rule, destinationOverride?: DestinationTransmission): Promise<TriggerMatch[]> {
  const destination = destinationOverride ?? (cfgString(rule.triggerConfig, "destination") as DestinationTransmission | undefined);
  if (!destination) return [];
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, statut: { key: { not: "CLOTURE" } } },
    select: { id: true },
  });
  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    const readiness = await evaluateTransmissionReadiness({ dossierId: d.id, organisationId: rule.organisationId, destination });
    if (readiness.status !== "READY") continue;
    matches.push({ entityType: "Dossier", entityId: d.id, triggerKey: `ready-${destination}`, context: { dossierId: d.id, destination } });
  }
  return matches;
}

// --- LEAD_CALLBACK_DUE : même filtre que le Next Best Action (P9) - jamais
// une seconde logique d'échéance de rappel.
export async function detectLeadCallbackDue(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const leads = await prisma.lead.findMany({
    where: { organisationId: rule.organisationId, statut: { key: { notIn: ["SIGNE", "PERDU"] } }, prochainContactAt: { lte: now } },
    select: { id: true, prenom: true, nom: true, commercialId: true, teleprospecteurId: true, prochainContactAt: true },
  });
  return leads.map((l) => ({
    entityType: "Lead",
    entityId: l.id,
    triggerKey: `due-${l.prochainContactAt!.toISOString().slice(0, 10)}`,
    context: { leadId: l.id, responsableUserId: l.teleprospecteurId ?? l.commercialId ?? null },
  }));
}

// --- APPOINTMENT_UPCOMING : RDV PLANIFIE dans les prochaines N heures
// (config withinHours, défaut 24) - même fenêtre que la NBA "RDV à
// confirmer" (P9), ici pour la notification commerciale (section 38/18.4).
export async function detectAppointmentUpcoming(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const withinHours = cfgNumber(rule.triggerConfig, "withinHours") ?? 24;
  const horizon = new Date(now.getTime() + withinHours * 3_600_000);
  const rdvs = await prisma.rdv.findMany({
    where: { organisationId: rule.organisationId, statut: "PLANIFIE", date: { gte: now, lte: horizon } },
    select: { id: true, date: true, commercialId: true, leadId: true, dossierId: true },
  });
  return rdvs.map((r) => ({
    entityType: "Rdv",
    entityId: r.id,
    triggerKey: "upcoming",
    context: { rdvId: r.id, commercialId: r.commercialId, leadId: r.leadId, dossierId: r.dossierId, date: r.date.toISOString() },
  }));
}

// --- FINANCIAL_PAYMENT_DUE / LATE : reprend mouvementIsLate (P6) - jamais
// une seconde logique de calcul de retard.
export async function detectFinancialPaymentLate(rule: Rule): Promise<TriggerMatch[]> {
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId: rule.organisationId, statut: { in: ["PREVU", "A_RECEVOIR", "A_PAYER", "PARTIEL"] } },
    select: { id: true, dossierId: true, datePrevue: true, statut: true, montantPrevuCts: true, montantReelCts: true, type: true },
  });
  return mouvements
    .filter((m) => mouvementIsLate(m))
    .map((m) => ({ entityType: "MouvementFinancier", entityId: m.id, triggerKey: "late", context: { dossierId: m.dossierId, mouvementId: m.id, type: m.type } }));
}

export async function detectFinancialPaymentDue(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const withinDays = cfgNumber(rule.triggerConfig, "withinDays") ?? 3;
  const horizon = new Date(now.getTime() + withinDays * 86_400_000);
  const mouvements = await prisma.mouvementFinancier.findMany({
    where: { organisationId: rule.organisationId, statut: { in: ["PREVU", "A_RECEVOIR", "A_PAYER"] }, datePrevue: { gte: now, lte: horizon } },
    select: { id: true, dossierId: true, type: true },
  });
  return mouvements.map((m) => ({ entityType: "MouvementFinancier", entityId: m.id, triggerKey: "due", context: { dossierId: m.dossierId, mouvementId: m.id, type: m.type } }));
}

// --- STUDY_STALE : reprend isStudyStale (P8) - jamais un simple timestamp.
export async function detectStudyStale(rule: Rule): Promise<TriggerMatch[]> {
  const etudes = await prisma.etudeDossier.findMany({
    where: { organisationId: rule.organisationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, dossierId: true, inputHash: true },
    distinct: ["dossierId"],
  });
  const matches: TriggerMatch[] = [];
  for (const e of etudes) {
    const context = await buildStudyContext(e.dossierId, rule.organisationId);
    if (!isStudyStale({ inputHash: e.inputHash }, context)) continue;
    matches.push({ entityType: "EtudeDossier", entityId: e.id, triggerKey: "stale", context: { dossierId: e.dossierId, etudeId: e.id } });
  }
  return matches;
}

// --- WORKFLOW_STEP_LATE : étape en cours dont l'échéance est dépassée.
export async function detectWorkflowStepLate(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const etapes = await prisma.dossierEtape.findMany({
    where: { organisationId: rule.organisationId, statut: { notIn: ["TERMINE", "IGNORE", "ANNULE"] }, dateEcheance: { lt: now } },
    select: { id: true, dossierId: true, assignedUserId: true, etapeProgramme: { select: { nom: true } } },
  });
  return etapes.map((e) => ({
    entityType: "DossierEtape",
    entityId: e.id,
    triggerKey: "late",
    context: { dossierId: e.dossierId, etapeId: e.id, assignedUserId: e.assignedUserId, etapeNom: e.etapeProgramme.nom },
  }));
}

// --- WORKFLOW_STEP_READY : étape venant de devenir disponible (A_FAIRE).
export async function detectWorkflowStepReady(rule: Rule): Promise<TriggerMatch[]> {
  const etapes = await prisma.dossierEtape.findMany({
    where: { organisationId: rule.organisationId, statut: "A_FAIRE" },
    select: { id: true, dossierId: true, assignedUserId: true, etapeProgramme: { select: { nom: true } } },
  });
  return etapes.map((e) => ({
    entityType: "DossierEtape",
    entityId: e.id,
    triggerKey: "ready",
    context: { dossierId: e.dossierId, etapeId: e.id, assignedUserId: e.assignedUserId, etapeNom: e.etapeProgramme.nom },
  }));
}

// --- DOSSIER_STATUS_CHANGED / ANAH_STATUS_CHANGED : triggerKey = valeur du
// statut lui-même, donc un changement VERS ce statut redéclenche
// exactement une fois, jamais à chaque scan tant que le statut ne change
// pas à nouveau.
export async function detectDossierStatusChanged(rule: Rule): Promise<TriggerMatch[]> {
  const statusKey = cfgString(rule.triggerConfig, "statusKey");
  if (!statusKey) return [];
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, statut: { key: statusKey } },
    select: { id: true, statutId: true },
  });
  return dossiers.map((d) => ({ entityType: "Dossier", entityId: d.id, triggerKey: `status-${d.statutId}`, context: { dossierId: d.id, statusKey } }));
}

export async function detectAnahStatusChanged(rule: Rule): Promise<TriggerMatch[]> {
  const statusKey = cfgString(rule.triggerConfig, "statusKey");
  if (!statusKey) return [];
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, statutAnah: { key: statusKey } },
    select: { id: true, statutAnahId: true },
  });
  return dossiers.map((d) => ({ entityType: "Dossier", entityId: d.id, triggerKey: `anah-${d.statutAnahId}`, context: { dossierId: d.id, statusKey } }));
}

// --- LEAD_STATUS_CHANGED : même principe que DOSSIER_STATUS_CHANGED.
export async function detectLeadStatusChanged(rule: Rule): Promise<TriggerMatch[]> {
  const statusKey = cfgString(rule.triggerConfig, "statusKey");
  if (!statusKey) return [];
  const leads = await prisma.lead.findMany({ where: { organisationId: rule.organisationId, statut: { key: statusKey } }, select: { id: true, statutId: true } });
  return leads.map((l) => ({ entityType: "Lead", entityId: l.id, triggerKey: `status-${l.statutId}`, context: { leadId: l.id, statusKey } }));
}

/**
 * Point d'entrée unique (dispatch) - le seul endroit qui associe un
 * triggerType à sa fonction de détection, utilisé par engine.ts.
 * MANUAL_TRIGGER n'a pas de détecteur : il ne produit un match que si
 * explicitement fourni par l'appelant (bouton "Exécuter"/"Tester").
 */
export async function detectTriggerMatches(rule: Rule & { triggerType: string }, now: Date): Promise<TriggerMatch[]> {
  switch (rule.triggerType) {
    case "DOCUMENT_MISSING":
      return detectDocumentMissing(rule, now);
    case "DOCUMENT_REJECTED":
      return detectDocumentRejected(rule);
    case "DOCUMENT_EXPIRED":
      return detectDocumentExpired(rule, now);
    case "TRANSMISSION_READY":
      return detectTransmissionReady(rule);
    case "CEE_READY":
      return detectTransmissionReady(rule, "CEE");
    case "LEAD_CALLBACK_DUE":
      return detectLeadCallbackDue(rule, now);
    case "APPOINTMENT_UPCOMING":
      return detectAppointmentUpcoming(rule, now);
    case "FINANCIAL_PAYMENT_LATE":
      return detectFinancialPaymentLate(rule);
    case "FINANCIAL_PAYMENT_DUE":
      return detectFinancialPaymentDue(rule, now);
    case "STUDY_STALE":
      return detectStudyStale(rule);
    case "WORKFLOW_STEP_LATE":
      return detectWorkflowStepLate(rule, now);
    case "WORKFLOW_STEP_READY":
      return detectWorkflowStepReady(rule);
    case "DOSSIER_STATUS_CHANGED":
      return detectDossierStatusChanged(rule);
    case "ANAH_STATUS_CHANGED":
      return detectAnahStatusChanged(rule);
    case "LEAD_STATUS_CHANGED":
      return detectLeadStatusChanged(rule);
    case "MANUAL_TRIGGER":
      return [];
    default:
      return [];
  }
}

// Réexporté pour les vérifications ponctuelles (ex. checklist dans
// actions.ts qui a besoin de recharger la checklist d'un dossier).
export { getDocumentChecklistForDossier };
