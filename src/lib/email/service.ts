import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getMissingDocumentsRelanceData } from "@/lib/documents/relance";
import { renderTemplate, formatMissingDocumentsList, type TemplateVariables } from "@/lib/automations/templates";
import { getEmailProvider } from "./provider";
import type { StatutEmailDraft } from "@/generated/prisma/enums";

// ============================================================
// Service email (P11, sections 8/12/13) - construit des messages à partir
// des moteurs existants (jamais une seconde logique de calcul des pièces
// manquantes : réutilise getMissingDocumentsRelanceData de P10), les
// enregistre comme EmailDraft (jamais envoyés implicitement), et journalise
// tout envoi réel dans EmailSendLog.
// ============================================================

export type BuiltEmailMessage = { sujet: string; corps: string; destinataire: string | null };

/**
 * Génère la demande groupée de pièces manquantes (section 8) - une seule
 * demande listant TOUTES les pièces manquantes côté client, jamais une par
 * pièce. Ne liste jamais une pièce déjà valide (garanti par
 * getMissingDocumentsRelanceData, qui ne renvoie que les MANQUANT).
 */
export async function buildMissingDocumentsMessage(dossierId: string, organisationId: string): Promise<BuiltEmailMessage> {
  const [relance, dossier] = await Promise.all([
    getMissingDocumentsRelanceData(dossierId, organisationId),
    prisma.dossier.findFirstOrThrow({
      where: { id: dossierId, organisationId },
      select: { reference: true, client: { select: { prenom: true, nom: true, email: true } }, organisation: { select: { nom: true } } },
    }),
  ]);

  const template = await getEmailTemplate("DEMANDE_PIECES", organisationId);
  const variables: TemplateVariables = {
    "client.prenom": dossier.client.prenom,
    "client.nom": dossier.client.nom,
    "dossier.reference": relance.dossierReference,
    "documents.manquants": formatMissingDocumentsList(relance.documentsManquants),
    "organisation.nom": dossier.organisation.nom,
  };

  return {
    sujet: renderTemplate(template.sujetTemplate, variables),
    corps: renderTemplate(template.bodyTemplate, variables),
    destinataire: dossier.client.email,
  };
}

/** Résout un template par code : org-scopé en priorité, sinon global (même pattern que le référentiel documentaire P10). */
export async function getEmailTemplate(code: string, organisationId: string) {
  const orgTemplate = await prisma.emailTemplate.findFirst({ where: { organisationId, code, actif: true } });
  if (orgTemplate) return orgTemplate;
  const globalTemplate = await prisma.emailTemplate.findFirst({ where: { organisationId: null, code, actif: true } });
  if (!globalTemplate) throw new Error(`Template email introuvable : ${code}`);
  return globalTemplate;
}

export async function createEmailDraft(params: {
  organisationId: string;
  templateId?: string | null;
  dossierId?: string | null;
  leadId?: string | null;
  destinataire: string;
  sujet: string;
  corps: string;
  createdById?: string | null;
}): Promise<string> {
  const draft = await prisma.emailDraft.create({
    data: {
      organisationId: params.organisationId,
      templateId: params.templateId ?? null,
      dossierId: params.dossierId ?? null,
      leadId: params.leadId ?? null,
      destinataire: params.destinataire,
      sujet: params.sujet,
      corps: params.corps,
      statut: "BROUILLON",
      createdById: params.createdById ?? null,
    },
  });
  if (params.createdById) {
    await logAudit({
      organisationId: params.organisationId,
      userId: params.createdById,
      entityType: "EmailDraft",
      entityId: draft.id,
      action: "EMAIL_PREPARE",
      metadata: { destinataire: params.destinataire, sujet: params.sujet },
    });
  }
  return draft.id;
}

/**
 * Envoie réellement un brouillon (section 13) - la version envoyée est
 * enregistrée telle quelle (EmailSendLog), succès ou échec, jamais
 * silencieusement perdue.
 */
export async function sendEmailDraft(draftId: string, organisationId: string, sentById: string | null): Promise<{ ok: boolean; error?: string }> {
  const draft = await prisma.emailDraft.findFirst({ where: { id: draftId, organisationId } });
  if (!draft) throw new Error("Brouillon introuvable.");
  if (draft.statut !== "BROUILLON") throw new Error("Ce brouillon a déjà été envoyé ou annulé.");

  const provider = getEmailProvider();
  const result = await provider.sendEmail({ to: draft.destinataire, subject: draft.sujet, body: draft.corps });

  await prisma.$transaction([
    prisma.emailDraft.update({ where: { id: draft.id }, data: { statut: (result.ok ? "ENVOYE" : "BROUILLON") as StatutEmailDraft } }),
    prisma.emailSendLog.create({
      data: {
        organisationId,
        draftId: draft.id,
        dossierId: draft.dossierId,
        leadId: draft.leadId,
        destinataire: draft.destinataire,
        sujet: draft.sujet,
        provider: provider.name,
        providerMessageId: result.providerMessageId ?? null,
        statut: result.ok ? "ENVOYE" : "ERREUR",
        erreur: result.error ?? null,
        sentById,
      },
    }),
  ]);

  if (sentById) {
    await logAudit({
      organisationId,
      userId: sentById,
      entityType: "EmailDraft",
      entityId: draft.id,
      action: result.ok ? "EMAIL_ENVOYE" : "EMAIL_ERREUR",
      metadata: { destinataire: draft.destinataire, provider: provider.name, erreur: result.error ?? null },
    });
  }

  return { ok: result.ok, error: result.error };
}
