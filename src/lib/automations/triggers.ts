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

// ============================================================
// P16 - missions (ST/régie), portail donneur d'ordre, RDV. Même discipline
// que ci-dessus : lecture seule, réutilise les modèles canoniques
// (TransmissionPackage, Dossier.donneurOrdreId, Facture, Rdv), jamais une
// seconde source de vérité. Le destinataire (email) est résolu ICI (jamais
// dans actions.ts) car seul le trigger sait, selon le cas, si c'est un
// utilisateur sous-traitant/régie/donneur d'ordre/commercial/interne - et
// ne renvoie QUE les champs déjà partagés (snapshot figé P15), jamais le
// client entier.
// ============================================================

async function firstActiveUserEmail(where: Record<string, unknown>): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { ...where, actif: true }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return user?.email ?? null;
}

// Email d'un partenaire : compte portail s'il existe, sinon l'email de
// contact saisi sur sa fiche (auparavant un partenaire SANS compte portail
// n'était jamais contacté). null si les emails automatiques sont coupés
// pour ce partenaire (paramétrage partenaire par partenaire).
export async function emailSousTraitant(id: string | null): Promise<string | null> {
  if (!id) return null;
  const st = await prisma.sousTraitant.findUnique({ where: { id }, select: { email: true, emailsAuto: true } });
  if (!st || !st.emailsAuto) return null;
  return (await firstActiveUserEmail({ sousTraitantId: id, role: "SOUS_TRAITANT" })) ?? st.email ?? null;
}
export async function emailDonneurOrdre(id: string | null): Promise<string | null> {
  if (!id) return null;
  const d = await prisma.donneurOrdre.findUnique({ where: { id }, select: { contactEmail: true, emailsAuto: true } });
  if (!d || !d.emailsAuto) return null;
  return (await firstActiveUserEmail({ donneurOrdreId: id, role: "DONNEUR_ORDRE" })) ?? d.contactEmail ?? null;
}
export async function emailDelegataireCee(id: string | null): Promise<string | null> {
  if (!id) return null;
  const d = await prisma.delegataireCee.findUnique({ where: { id }, select: { contactEmail: true, emailsAuto: true } });
  if (!d || !d.emailsAuto) return null;
  return d.contactEmail ?? (await firstActiveUserEmail({ delegataireCeeId: id, role: "DELEGATAIRE_CEE" }));
}

// P16 - cadence de relance idempotente (J0/J+3/J+7...) pour une "action
// requise" en attente : chaque palier est une règle distincte avec son
// propre stepIndex/delayJours (même principe que DOCUMENT_MISSING), gaté
// par une fenêtre [delayJours, delayJoursDuPasSuivant) pour ne jamais
// matcher deux pas à la fois même si le scheduler tourne moins souvent que
// la cadence. Dès que l'entité sort de l'état "en attente" (ex. mission
// acceptée/refusée, complément répondu), plus aucun pas ne matche - la
// relance s'arrête automatiquement, sans logique d'annulation séparée.
function stepWindowMatches(anchor: Date, now: Date, delayJours: number, nextDelayJours: number | null): boolean {
  const joursDepuis = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
  if (joursDepuis < delayJours) return false;
  if (nextDelayJours != null && joursDepuis >= nextDelayJours) return false;
  return true;
}

const MISSION_ST_CREEE_STEPS = [0, 3, 7]; // J0 (notification), J+3, J+7 (relances si toujours sans réponse)

export async function detectMissionStCreee(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const delayJours = MISSION_ST_CREEE_STEPS[stepIndex] ?? 0;
  const nextDelayJours = MISSION_ST_CREEE_STEPS[stepIndex + 1] ?? null;

  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, destinationSousTraitantId: { not: null }, status: "ENVOYEE" },
    select: { id: true, dossierId: true, destinationSousTraitantId: true, transmittedAt: true, createdAt: true },
  });
  const matches: TriggerMatch[] = [];
  for (const m of missions) {
    const anchor = m.transmittedAt ?? m.createdAt;
    if (!stepWindowMatches(anchor, now, delayJours, nextDelayJours)) continue;
    const destinataireEmail = await emailSousTraitant(m.destinationSousTraitantId);
    if (!destinataireEmail) continue;
    matches.push({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: `step-${stepIndex}`, context: { missionId: m.id, dossierId: m.dossierId, destinataireEmail } });
  }
  return matches;
}

export async function detectMissionStAcceptee(rule: Rule): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, status: "ACCEPTEE" },
    select: { id: true, dossierId: true },
  });
  return missions.map((m) => ({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: "accepted", context: { missionId: m.id, dossierId: m.dossierId } }));
}

export async function detectMissionStRefusee(rule: Rule): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, status: "REFUSEE" },
    select: { id: true, dossierId: true, refusalReason: true },
  });
  return missions.map((m) => ({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: "refused", context: { missionId: m.id, dossierId: m.dossierId, motif: m.refusalReason } }));
}

export async function detectMissionChantierProgramme(rule: Rule): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, status: "PLANIFIEE" },
    select: { id: true, dossierId: true, destinationSousTraitantId: true, destinationRegieId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const m of missions) {
    const destinataireEmail = m.destinationSousTraitantId ? await emailSousTraitant(m.destinationSousTraitantId) : null;
    matches.push({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: "programmed", context: { missionId: m.id, dossierId: m.dossierId, destinataireEmail } });
  }
  return matches;
}

// Une nouvelle valeur de date (ou un premier renseignement) redéclenche -
// jamais si les deux dates restent identiques au tour précédent.
export async function detectMissionDateModifiee(rule: Rule): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: {
      organisationId: rule.organisationId,
      posteTravauxId: { not: null },
      OR: [{ dateDebutSouhaitee: { not: null } }, { dateFinSouhaitee: { not: null } }],
    },
    select: { id: true, dossierId: true, dateDebutSouhaitee: true, dateFinSouhaitee: true, destinationSousTraitantId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const m of missions) {
    const key = `date-${m.dateDebutSouhaitee?.toISOString() ?? "x"}-${m.dateFinSouhaitee?.toISOString() ?? "x"}`;
    const destinataireEmail = m.destinationSousTraitantId ? await emailSousTraitant(m.destinationSousTraitantId) : null;
    matches.push({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: key, context: { missionId: m.id, dossierId: m.dossierId, destinataireEmail } });
  }
  return matches;
}

export async function detectMissionTerminee(rule: Rule): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, status: "TERMINEE" },
    select: { id: true, dossierId: true },
  });
  return missions.map((m) => ({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: "done", context: { missionId: m.id, dossierId: m.dossierId } }));
}

export async function detectDoDemandeRecue(rule: Rule): Promise<TriggerMatch[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, donneurOrdreId: { not: null } },
    select: { id: true, donneurOrdreId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    // destinataireEmail = le donneur d'ordre lui-même (accusé de réception).
    const destinataireEmail = await emailDonneurOrdre(d.donneurOrdreId);
    matches.push({ entityType: "Dossier", entityId: d.id, triggerKey: "received", context: { dossierId: d.id, destinataireEmail } });
  }
  return matches;
}

const DO_COMPLEMENT_STEPS = [0, 1, 3]; // J0 (demande), J+1 (urgent - info bloquante), J+3

export async function detectDoComplementRequis(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const delayJours = DO_COMPLEMENT_STEPS[stepIndex] ?? 0;
  const nextDelayJours = DO_COMPLEMENT_STEPS[stepIndex + 1] ?? null;

  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, donneurOrdreId: { not: null }, complementDemandeMessage: { not: null }, complementDemandeAt: { not: null }, complementReponseMessage: null },
    select: { id: true, donneurOrdreId: true, complementDemandeAt: true },
  });
  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    if (!stepWindowMatches(d.complementDemandeAt!, now, delayJours, nextDelayJours)) continue;
    const destinataireEmail = await emailDonneurOrdre(d.donneurOrdreId);
    if (!destinataireEmail) continue;
    // triggerKey inclut complementDemandeAt : une NOUVELLE demande (après une
    // réponse précédente) relance la cadence à zéro, jamais confondue avec
    // l'ancienne (cf. detectDoComplementRecu, même principe).
    matches.push({ entityType: "Dossier", entityId: d.id, triggerKey: `requested-${d.complementDemandeAt!.toISOString()}-step-${stepIndex}`, context: { dossierId: d.id, destinataireEmail } });
  }
  return matches;
}

export async function detectDoComplementRecu(rule: Rule): Promise<TriggerMatch[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, donneurOrdreId: { not: null }, complementReponseMessage: { not: null }, complementReponseAt: { not: null } },
    select: { id: true, complementReponseAt: true },
  });
  return dossiers.map((d) => ({ entityType: "Dossier", entityId: d.id, triggerKey: `received-${d.complementReponseAt!.toISOString()}`, context: { dossierId: d.id } }));
}

async function detectDoDossierStatusKeys(rule: Rule, statusKeys: string[], keyPrefix: string): Promise<TriggerMatch[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, donneurOrdreId: { not: null }, statut: { key: { in: statusKeys } } },
    select: { id: true, statutId: true, donneurOrdreId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    const destinataireEmail = await emailDonneurOrdre(d.donneurOrdreId);
    if (!destinataireEmail) continue;
    matches.push({ entityType: "Dossier", entityId: d.id, triggerKey: `${keyPrefix}-${d.statutId}`, context: { dossierId: d.id, destinataireEmail } });
  }
  return matches;
}

export async function detectDoChantierAccepte(rule: Rule): Promise<TriggerMatch[]> {
  return detectDoDossierStatusKeys(rule, ["ACCEPTE"], "status");
}
export async function detectDoChantierProgramme(rule: Rule): Promise<TriggerMatch[]> {
  return detectDoDossierStatusKeys(rule, ["TRAVAUX_PLANIFIES"], "status");
}
export async function detectDoChantierTermine(rule: Rule): Promise<TriggerMatch[]> {
  return detectDoDossierStatusKeys(rule, ["TRAVAUX_TERMINES"], "status");
}
export async function detectDoChantierRefuse(rule: Rule): Promise<TriggerMatch[]> {
  return detectDoDossierStatusKeys(rule, ["REFUSE"], "status");
}

// ============================================================
// Pilotage poses / facturation / délégataires (circuits "on pose pour un
// partenaire" et "on confie nos poses"). Mêmes principes : lecture seule,
// triggerKey stable, arrêt automatique dès que la situation est réglée.
// ============================================================

function joursDepuis(d: Date, now: Date): number {
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

// Pose confiée à la régie interne sans date de chantier : à planifier.
export async function detectMissionRegieAPlanifier(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, destinationRegieId: { not: null }, status: { in: ["ENVOYEE", "ACCEPTEE"] }, dateDebutSouhaitee: null },
    select: { id: true, dossierId: true, createdAt: true },
  });
  return missions
    .filter((m) => joursDepuis(m.createdAt, now) >= (rule.delayJours ?? 0))
    .map((m) => ({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: "a-planifier", context: { missionId: m.id, dossierId: m.dossierId } }));
}

// Mission sous-traitant terminée sans facture déposée : relance du ST
// (J+3, J+10), s'arrête dès qu'une facture active existe pour le poste.
const ST_FACTURE_STEPS = [3, 10];
export async function detectMissionStFactureAttendue(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const delay = ST_FACTURE_STEPS[stepIndex] ?? 3;
  const next = ST_FACTURE_STEPS[stepIndex + 1] ?? null;
  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: rule.organisationId, posteTravauxId: { not: null }, destinationSousTraitantId: { not: null }, status: "TERMINEE" },
    select: { id: true, dossierId: true, updatedAt: true, destinationSousTraitantId: true, posteTravauxId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const m of missions) {
    if (!stepWindowMatches(m.updatedAt, now, delay, next)) continue;
    const facture = await prisma.facture.findFirst({
      where: { type: "SOUS_TRAITANT", dossierId: m.dossierId, sousTraitantId: m.destinationSousTraitantId, statut: { notIn: ["ANNULEE", "REFUSEE"] } },
      select: { id: true },
    });
    if (facture) continue;
    const destinataireEmail = await emailSousTraitant(m.destinationSousTraitantId);
    matches.push({ entityType: "TransmissionPackage", entityId: m.id, triggerKey: `facture-attendue-${stepIndex}`, context: { missionId: m.id, dossierId: m.dossierId, destinataireEmail } });
  }
  return matches;
}

// Facture sous-traitant reçue, à contrôler / valider par la compta.
export async function detectFactureStAValider(rule: Rule): Promise<TriggerMatch[]> {
  const factures = await prisma.facture.findMany({
    where: { organisationId: rule.organisationId, type: "SOUS_TRAITANT", statut: { in: ["RECUE", "A_CONTROLER"] } },
    select: { id: true, dossierId: true },
  });
  return factures.map((f) => ({ entityType: "Facture", entityId: f.id, triggerKey: "a-valider", context: { factureId: f.id, dossierId: f.dossierId } }));
}

// Facture à payer (sous-traitant) : échéance dans les N jours puis échue.
export async function detectFactureAPayer(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const withinDays = cfgNumber(rule.triggerConfig, "withinDays") ?? 3;
  const limite = new Date(now.getTime() + withinDays * 86_400_000);
  const factures = await prisma.facture.findMany({
    where: { organisationId: rule.organisationId, type: "SOUS_TRAITANT", statut: { in: ["A_PAYER", "PARTIELLEMENT_PAYEE", "VALIDEE"] }, dateEcheance: { not: null, lte: limite } },
    select: { id: true, dossierId: true, dateEcheance: true },
  });
  return factures.map((f) => ({
    entityType: "Facture",
    entityId: f.id,
    triggerKey: f.dateEcheance! < now ? "echue" : "bientot",
    context: { factureId: f.id, dossierId: f.dossierId },
  }));
}

// Chantier d'un donneur d'ordre terminé sans facture DO émise.
export async function detectDoAFacturer(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const dossiers = await prisma.dossier.findMany({
    where: {
      organisationId: rule.organisationId,
      donneurOrdreId: { not: null },
      statut: { key: { in: ["TRAVAUX_TERMINES", "CONTROLE_EN_COURS", "SOLDE_DEMANDE"] } },
      factures: { none: { type: "DONNEUR_ORDRE", statut: { notIn: ["ANNULEE"] } } },
    },
    select: { id: true, dateFinTravaux: true, updatedAt: true },
  });
  return dossiers
    .filter((d) => joursDepuis(d.dateFinTravaux ?? d.updatedAt, now) >= (rule.delayJours ?? 0))
    .map((d) => ({ entityType: "Dossier", entityId: d.id, triggerKey: "a-facturer", context: { dossierId: d.id } }));
}

// Dossier CEE : travaux terminés, délégataire choisi, pas encore déposé.
export async function detectCeeDepotAFaire(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const dossiers = await prisma.dossier.findMany({
    where: {
      organisationId: rule.organisationId,
      delegataireCeeId: { not: null },
      montantAideCEE: { gt: 0 },
      dateDepotDelegataireCee: null,
      statut: { key: { in: ["TRAVAUX_TERMINES", "CONTROLE_EN_COURS", "SOLDE_DEMANDE"] } },
    },
    select: { id: true, dateFinTravaux: true, updatedAt: true },
  });
  return dossiers
    .filter((d) => joursDepuis(d.dateFinTravaux ?? d.updatedAt, now) >= (rule.delayJours ?? 0))
    .map((d) => ({ entityType: "Dossier", entityId: d.id, triggerKey: "depot-a-faire", context: { dossierId: d.id } }));
}

// Prime CEE non versée à l'échéance (dépôt + délai du délégataire) :
// relance du délégataire J0/J+7/J+15, arrêt dès que la prime est encaissée
// (agrégat dossier OU mouvement ENCAISSEMENT_CEE soldé).
const CEE_RETARD_STEPS = [0, 7, 15];
export async function detectCeePaiementRetard(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const delay = CEE_RETARD_STEPS[stepIndex] ?? 0;
  const next = CEE_RETARD_STEPS[stepIndex + 1] ?? null;
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: rule.organisationId, delegataireCeeId: { not: null }, montantAideCEE: { gt: 0 }, dateDepotDelegataireCee: { not: null }, statut: { key: { not: "CLOTURE" } } },
    select: {
      id: true,
      delegataireCeeId: true,
      montantAideCEE: true,
      montantEncaisseCEE: true,
      dateDepotDelegataireCee: true,
      delegataireCee: { select: { delaiPaiementJours: true } },
      mouvementsFinanciers: { where: { categorie: "ENCAISSEMENT_CEE", statut: { not: "ANNULE" } }, select: { montantPrevuCts: true, montantReelCts: true, statut: true } },
    },
  });
  const matches: TriggerMatch[] = [];
  for (const d of dossiers) {
    const delai = d.delegataireCee?.delaiPaiementJours;
    if (delai == null) continue;
    const echeance = new Date(d.dateDepotDelegataireCee!.getTime() + delai * 86_400_000);
    if (echeance > now) continue;
    const ms = d.mouvementsFinanciers;
    const solde = ms.length > 0 ? ms.every((m) => m.statut === "RECU" || (m.montantReelCts ?? 0) >= (m.montantPrevuCts ?? 0)) : d.montantEncaisseCEE >= d.montantAideCEE;
    if (solde) continue;
    if (!stepWindowMatches(echeance, now, delay, next)) continue;
    const destinataireEmail = await emailDelegataireCee(d.delegataireCeeId);
    matches.push({ entityType: "Dossier", entityId: d.id, triggerKey: `cee-retard-${stepIndex}`, context: { dossierId: d.id, destinataireEmail, echeance: echeance.toISOString() } });
  }
  return matches;
}

export async function detectDoFactureDisponible(rule: Rule): Promise<TriggerMatch[]> {
  const factures = await prisma.facture.findMany({
    where: { organisationId: rule.organisationId, type: "DONNEUR_ORDRE", statut: { not: "BROUILLON" }, donneurOrdreId: { not: null } },
    select: { id: true, dossierId: true, donneurOrdreId: true },
  });
  const matches: TriggerMatch[] = [];
  for (const f of factures) {
    const destinataireEmail = await emailDonneurOrdre(f.donneurOrdreId);
    if (!destinataireEmail) continue;
    matches.push({ entityType: "Facture", entityId: f.id, triggerKey: "available", context: { factureId: f.id, dossierId: f.dossierId, destinataireEmail } });
  }
  return matches;
}

// Distinct de FINANCIAL_PAYMENT_LATE (générique, sans email, déjà utilisé
// pour la dette fournisseur ST via la tâche PAIEMENT_RETARD - jamais
// dupliqué ici) : ce trigger ne concerne QUE les factures DONNEUR_ORDRE
// émises, non réglées, dont l'échéance est dépassée - relance le DO
// directement par email, cadence idempotente J0/J+7/J+15 avec arrêt
// automatique dès que le mouvement lié passe RECU/PAYE (cf. stepWindowMatches).
const DO_FACTURE_ECHUE_STEPS = [0, 7, 15];

export async function detectDoFactureEchue(rule: Rule, now: Date): Promise<TriggerMatch[]> {
  const stepIndex = cfgNumber(rule.triggerConfig, "stepIndex") ?? 0;
  const delayJours = DO_FACTURE_ECHUE_STEPS[stepIndex] ?? 0;
  const nextDelayJours = DO_FACTURE_ECHUE_STEPS[stepIndex + 1] ?? null;

  const factures = await prisma.facture.findMany({
    where: { organisationId: rule.organisationId, type: "DONNEUR_ORDRE", statut: { in: ["EMISE", "TRANSMISE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] }, donneurOrdreId: { not: null }, dateEcheance: { not: null, lte: now } },
    select: { id: true, dossierId: true, donneurOrdreId: true, dateEcheance: true, mouvementFinancier: { select: { statut: true } } },
  });

  const matches: TriggerMatch[] = [];
  for (const f of factures) {
    if (f.mouvementFinancier && (f.mouvementFinancier.statut === "RECU" || f.mouvementFinancier.statut === "PAYE")) continue;
    if (!stepWindowMatches(f.dateEcheance!, now, delayJours, nextDelayJours)) continue;
    const destinataireEmail = await emailDonneurOrdre(f.donneurOrdreId);
    if (!destinataireEmail) continue;
    matches.push({ entityType: "Facture", entityId: f.id, triggerKey: `step-${stepIndex}`, context: { factureId: f.id, dossierId: f.dossierId, destinataireEmail } });
  }
  return matches;
}

export async function detectRegieNouveauLead(rule: Rule): Promise<TriggerMatch[]> {
  const leads = await prisma.lead.findMany({ where: { organisationId: rule.organisationId }, select: { id: true, commercialId: true, teleprospecteurId: true } });
  return leads.map((l) => ({
    entityType: "Lead",
    entityId: l.id,
    triggerKey: "created",
    context: { leadId: l.id, responsableUserId: l.teleprospecteurId ?? l.commercialId ?? null },
  }));
}

export async function detectRdvCree(rule: Rule): Promise<TriggerMatch[]> {
  const rdvs = await prisma.rdv.findMany({ where: { organisationId: rule.organisationId }, select: { id: true, commercialId: true, dossierId: true, leadId: true } });
  return rdvs.map((r) => ({ entityType: "Rdv", entityId: r.id, triggerKey: "created", context: { rdvId: r.id, commercialId: r.commercialId, dossierId: r.dossierId, leadId: r.leadId } }));
}

// Une modification (y compris une annulation) redéclenche une fois par
// nouvelle valeur de updatedAt - jamais deux fois pour la même édition.
export async function detectRdvModifieOuAnnule(rule: Rule): Promise<TriggerMatch[]> {
  const rdvs = await prisma.rdv.findMany({
    where: { organisationId: rule.organisationId },
    select: { id: true, commercialId: true, dossierId: true, leadId: true, createdAt: true, updatedAt: true, statut: true },
  });
  const matches: TriggerMatch[] = [];
  for (const r of rdvs) {
    const modifie = r.updatedAt.getTime() - r.createdAt.getTime() > 5_000;
    if (!modifie && r.statut !== "ANNULE") continue;
    matches.push({
      entityType: "Rdv",
      entityId: r.id,
      triggerKey: `modif-${r.updatedAt.toISOString()}`,
      context: { rdvId: r.id, commercialId: r.commercialId, dossierId: r.dossierId, leadId: r.leadId },
    });
  }
  return matches;
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
    case "MISSION_ST_CREEE":
      return detectMissionStCreee(rule, now);
    case "MISSION_ST_ACCEPTEE":
      return detectMissionStAcceptee(rule);
    case "MISSION_ST_REFUSEE":
      return detectMissionStRefusee(rule);
    case "MISSION_CHANTIER_PROGRAMME":
      return detectMissionChantierProgramme(rule);
    case "MISSION_DATE_MODIFIEE":
      return detectMissionDateModifiee(rule);
    case "MISSION_TERMINEE":
      return detectMissionTerminee(rule);
    case "DO_DEMANDE_RECUE":
      return detectDoDemandeRecue(rule);
    case "DO_COMPLEMENT_REQUIS":
      return detectDoComplementRequis(rule, now);
    case "DO_COMPLEMENT_RECU":
      return detectDoComplementRecu(rule);
    case "DO_CHANTIER_ACCEPTE":
      return detectDoChantierAccepte(rule);
    case "DO_CHANTIER_PROGRAMME":
      return detectDoChantierProgramme(rule);
    case "DO_CHANTIER_TERMINE":
      return detectDoChantierTermine(rule);
    case "DO_FACTURE_DISPONIBLE":
      return detectDoFactureDisponible(rule);
    case "DO_FACTURE_ECHUE":
      return detectDoFactureEchue(rule, now);
    case "DO_CHANTIER_REFUSE":
      return detectDoChantierRefuse(rule);
    case "DO_A_FACTURER":
      return detectDoAFacturer(rule, now);
    case "MISSION_REGIE_A_PLANIFIER":
      return detectMissionRegieAPlanifier(rule, now);
    case "MISSION_ST_FACTURE_ATTENDUE":
      return detectMissionStFactureAttendue(rule, now);
    case "FACTURE_ST_A_VALIDER":
      return detectFactureStAValider(rule);
    case "FACTURE_A_PAYER":
      return detectFactureAPayer(rule, now);
    case "CEE_DEPOT_A_FAIRE":
      return detectCeeDepotAFaire(rule, now);
    case "CEE_PAIEMENT_RETARD":
      return detectCeePaiementRetard(rule, now);
    case "REGIE_NOUVEAU_LEAD":
      return detectRegieNouveauLead(rule);
    case "RDV_CREE":
      return detectRdvCree(rule);
    case "RDV_MODIFIE_OU_ANNULE":
      return detectRdvModifieOuAnnule(rule);
    case "MANUAL_TRIGGER":
      return [];
    default:
      return [];
  }
}

// Réexporté pour les vérifications ponctuelles (ex. checklist dans
// actions.ts qui a besoin de recharger la checklist d'un dossier).
export { getDocumentChecklistForDossier };
