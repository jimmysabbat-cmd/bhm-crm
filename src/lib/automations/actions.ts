import { prisma } from "@/lib/prisma";
import { buildMissingDocumentsMessage, createEmailDraft, getEmailTemplate } from "@/lib/email/service";
import { renderTemplate, type TemplateVariables } from "@/lib/automations/templates";
import { createNotification } from "@/lib/notifications/service";
import { buildTransmissionPackagePreview } from "@/lib/documents/transmission";
import { emitDomainEvent, type DomainEvent } from "@/lib/webhooks/service";
import type { ActionOutcome, AutomationRuleData, TriggerMatch } from "./types";
import type { Role, TypeTache, DestinationTransmission } from "@/generated/prisma/enums";

// ============================================================
// Exécution des actions (P11, section 3) - chaque action est une fonction
// pure vis-à-vis du moteur : elle lit son actionConfig + le contexte fourni
// par le trigger, et produit un effet précis. UPDATE_STATUS_IF_SAFE est
// volontairement le plus restreint (section 3, avertissement explicite) :
// seules des transitions explicitement whitelistées sont autorisées.
// ============================================================

function cfgString(cfg: Record<string, unknown> | null, key: string): string | undefined {
  const v = cfg?.[key];
  return typeof v === "string" ? v : undefined;
}

async function resolveUserByRole(organisationId: string, role: string): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { organisationId, role: role as Role, actif: true }, orderBy: { createdAt: "asc" } });
  return user?.id ?? null;
}

async function actionCreateTask(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const dossierId = match.context.dossierId as string | undefined;
  if (!dossierId) return { status: "SKIPPED", result: { reason: "Pas de dossier rattaché - CREATE_TASK nécessite un dossierId." } };

  const titre = cfgString(rule.actionConfig, "titre") ?? rule.nom;
  const description = cfgString(rule.actionConfig, "description") ?? null;
  const type = (cfgString(rule.actionConfig, "typeTache") as TypeTache | undefined) ?? "AUTRE";
  const assigneRole = cfgString(rule.actionConfig, "assigneRole");
  const assigneAId = assigneRole ? await resolveUserByRole(rule.organisationId, assigneRole) : null;
  const delaiJours = rule.delayJours ?? 3;

  const tache = await prisma.tache.create({
    data: {
      dossierId,
      type,
      titre,
      description,
      dateEcheance: new Date(Date.now() + delaiJours * 86_400_000),
      assigneAId,
    },
  });
  return { status: "SUCCESS", result: { tacheId: tache.id } };
}

async function actionCreateNotification(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const targetRole = cfgString(rule.actionConfig, "targetRole");
  const title = cfgString(rule.actionConfig, "title") ?? rule.nom;
  const message = cfgString(rule.actionConfig, "message") ?? rule.nom;

  const explicitUserId = (match.context.assignedUserId as string | null) ?? (match.context.commercialId as string | null) ?? (match.context.responsableUserId as string | null) ?? null;

  const userIds: string[] = [];
  if (explicitUserId) {
    userIds.push(explicitUserId);
  } else if (targetRole) {
    const users = await prisma.user.findMany({ where: { organisationId: rule.organisationId, role: targetRole as Role, actif: true }, select: { id: true } });
    userIds.push(...users.map((u) => u.id));
  }
  if (userIds.length === 0) return { status: "SKIPPED", result: { reason: "Aucun destinataire résolu pour la notification." } };

  for (const userId of userIds) {
    await createNotification({
      userId,
      organisationId: rule.organisationId,
      type: rule.triggerType,
      title,
      message,
      entityType: match.entityType,
      entityId: match.entityId,
    });
  }
  return { status: "SUCCESS", result: { notifiedUserIds: userIds } };
}

async function buildEmailFromMatch(rule: AutomationRuleData, match: TriggerMatch): Promise<{ sujet: string; corps: string; destinataire: string | null; templateId: string | null }> {
  const dossierId = match.context.dossierId as string | undefined;
  const templateCode = cfgString(rule.actionConfig, "templateCode");

  if (rule.triggerType === "DOCUMENT_MISSING" && dossierId) {
    const built = await buildMissingDocumentsMessage(dossierId, rule.organisationId);
    const template = await getEmailTemplate("DEMANDE_PIECES", rule.organisationId);
    return { ...built, templateId: template.id };
  }

  if (!templateCode) throw new Error("actionConfig.templateCode requis pour préparer cet email.");
  const template = await getEmailTemplate(templateCode, rule.organisationId);
  const dossier = dossierId
    ? await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: rule.organisationId }, select: { reference: true, client: { select: { prenom: true, nom: true, email: true } }, organisation: { select: { nom: true } } } })
    : null;
  const variables: TemplateVariables = {
    "client.prenom": dossier?.client.prenom,
    "client.nom": dossier?.client.nom,
    "dossier.reference": dossier?.reference,
    "organisation.nom": dossier?.organisation.nom,
    "document.nom": match.context.typeDocumentNom as string | undefined,
    "document.motifRefus": (match.context.motif as string | null) ?? undefined,
  };
  return {
    sujet: renderTemplate(template.sujetTemplate, variables),
    corps: renderTemplate(template.bodyTemplate, variables),
    destinataire: dossier?.client.email ?? null,
    templateId: template.id,
  };
}

async function actionPrepareOrSendEmail(rule: AutomationRuleData, match: TriggerMatch, allowSend: boolean): Promise<ActionOutcome> {
  const built = await buildEmailFromMatch(rule, match);
  if (!built.destinataire) return { status: "SKIPPED", result: { reason: "Aucune adresse email destinataire connue." } };

  const draftId = await createEmailDraft({
    organisationId: rule.organisationId,
    templateId: built.templateId,
    dossierId: (match.context.dossierId as string | undefined) ?? null,
    leadId: (match.context.leadId as string | undefined) ?? null,
    destinataire: built.destinataire,
    sujet: built.sujet,
    corps: built.corps,
  });

  if (!allowSend) return { status: "SUCCESS", result: { draftId, sent: false } };

  const { sendEmailDraft } = await import("@/lib/email/service");
  const sendResult = await sendEmailDraft(draftId, rule.organisationId, null);
  return { status: sendResult.ok ? "SUCCESS" : "ERROR", result: { draftId, sent: sendResult.ok }, error: sendResult.error };
}

async function actionPrepareDocumentRequest(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  return actionPrepareOrSendEmail(rule, match, false);
}

async function actionPrepareTransmission(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const dossierId = match.context.dossierId as string | undefined;
  const destination = (match.context.destination as DestinationTransmission | undefined) ?? (cfgString(rule.actionConfig, "destination") as DestinationTransmission | undefined);
  if (!dossierId || !destination) return { status: "SKIPPED", result: { reason: "dossierId/destination manquant pour PREPARE_TRANSMISSION." } };
  // Ne crée JAMAIS un package automatiquement (P10, section 16 : aucun ZIP
  // automatique avant validation humaine) - se contente de calculer et de
  // renvoyer l'aperçu, comme un humain le ferait avant de cliquer "Créer".
  const preview = await buildTransmissionPackagePreview({ dossierId, organisationId: rule.organisationId, destination });
  return { status: "SUCCESS", result: { included: preview.included.length, excluded: preview.excluded.length, missing: preview.missingDocuments.length } };
}

async function actionMarkFlag(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const flag = cfgString(rule.actionConfig, "flag") ?? "flagged";
  return { status: "SUCCESS", result: { flag, entityType: match.entityType, entityId: match.entityId } };
}

async function actionAssignUser(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const role = cfgString(rule.actionConfig, "role");
  if (!role) return { status: "SKIPPED", result: { reason: "actionConfig.role requis pour ASSIGN_USER." } };
  const userId = await resolveUserByRole(rule.organisationId, role);
  if (!userId) return { status: "SKIPPED", result: { reason: `Aucun utilisateur actif de rôle ${role}.` } };

  if (match.entityType === "DossierEtape") {
    const etape = await prisma.dossierEtape.findFirst({ where: { id: match.entityId, organisationId: rule.organisationId } });
    if (!etape) return { status: "SKIPPED", result: { reason: "Étape introuvable." } };
    if (etape.assignedUserId) return { status: "SKIPPED", result: { reason: "Étape déjà assignée - jamais réassignée silencieusement." } };
    await prisma.dossierEtape.update({ where: { id: etape.id }, data: { assignedUserId: userId } });
    return { status: "SUCCESS", result: { assignedUserId: userId } };
  }
  return { status: "SKIPPED", result: { reason: `ASSIGN_USER non supporté pour ${match.entityType}.` } };
}

// Transitions explicitement autorisées (section 3 : "n'est autorisé que sur
// des transitions explicitement configurées" - jamais une heuristique
// libre). Ajouter une entrée ici est une décision produit délibérée, pas
// un simple paramétrage.
const ALLOWED_STATUS_TRANSITIONS: Record<string, { model: "DossierEtape"; field: "statut" }> = {
  "DossierEtape.statut": { model: "DossierEtape", field: "statut" },
};

async function actionUpdateStatusIfSafe(rule: AutomationRuleData, match: TriggerMatch): Promise<ActionOutcome> {
  const transitionKey = cfgString(rule.actionConfig, "transition");
  const from = cfgString(rule.actionConfig, "from");
  const to = cfgString(rule.actionConfig, "to");
  if (!transitionKey || !from || !to || !ALLOWED_STATUS_TRANSITIONS[transitionKey]) {
    return { status: "SKIPPED", result: { reason: "Transition non whitelistée - UPDATE_STATUS_IF_SAFE refusé par sécurité." } };
  }
  if (match.entityType !== "DossierEtape") return { status: "SKIPPED", result: { reason: "Entité non supportée pour cette transition." } };

  const etape = await prisma.dossierEtape.findFirst({ where: { id: match.entityId, organisationId: rule.organisationId } });
  if (!etape) return { status: "SKIPPED", result: { reason: "Étape introuvable." } };
  if (etape.statut !== from) return { status: "SKIPPED", result: { reason: `Statut actuel (${etape.statut}) différent de la transition attendue (${from}).` } };

  await prisma.dossierEtape.update({ where: { id: etape.id }, data: { statut: to as never } });
  return { status: "SUCCESS", result: { from, to } };
}

async function actionWebhookOutgoing(rule: AutomationRuleData, match: TriggerMatch, allowSend: boolean): Promise<ActionOutcome> {
  const event = (cfgString(rule.actionConfig, "event") as DomainEvent | undefined) ?? "PACKAGE_READY";
  if (!allowSend) return { status: "SUCCESS", result: { event, sent: false, reason: "Mode PREPARE_ONLY - webhook non émis." } };
  await emitDomainEvent(rule.organisationId, event, { entityType: match.entityType, entityId: match.entityId, ...match.context });
  return { status: "SUCCESS", result: { event, sent: true } };
}

/**
 * Exécute l'action d'une règle pour UN match donné. `allowExternalEffects`
 * reflète le mode de la règle (AUTO seul autorise un envoi/webhook réel -
 * cf. engine.ts) : cette fonction ne décide jamais elle-même du mode.
 */
export async function executeAction(rule: AutomationRuleData, match: TriggerMatch, allowExternalEffects: boolean): Promise<ActionOutcome> {
  switch (rule.actionType) {
    case "CREATE_TASK":
      return actionCreateTask(rule, match);
    case "CREATE_NOTIFICATION":
      return actionCreateNotification(rule, match);
    case "PREPARE_EMAIL":
      return actionPrepareOrSendEmail(rule, match, false);
    case "SEND_EMAIL":
      return actionPrepareOrSendEmail(rule, match, allowExternalEffects);
    case "PREPARE_DOCUMENT_REQUEST":
      return actionPrepareDocumentRequest(rule, match);
    case "PREPARE_TRANSMISSION":
      return actionPrepareTransmission(rule, match);
    case "MARK_FLAG":
      return actionMarkFlag(rule, match);
    case "ASSIGN_USER":
      return actionAssignUser(rule, match);
    case "UPDATE_STATUS_IF_SAFE":
      return actionUpdateStatusIfSafe(rule, match);
    case "WEBHOOK_OUTGOING":
      return actionWebhookOutgoing(rule, match, allowExternalEffects);
    default:
      return { status: "ERROR", error: `Type d'action inconnu : ${rule.actionType}` };
  }
}
