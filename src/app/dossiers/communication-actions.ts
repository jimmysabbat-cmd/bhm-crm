"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessDossierCommunication } from "@/lib/authz";
import { buildMissingDocumentsMessage, createEmailDraft, sendEmailDraft, getEmailTemplate } from "@/lib/email/service";
import { renderTemplate, type TemplateVariables } from "@/lib/automations/templates";

// ============================================================
// Communications dossier (P11, section 21) - préparer une demande de
// pièces, envoyer un brouillon, consulter l'historique. Un email n'est
// JAMAIS envoyé automatiquement depuis cette UI : préparer puis envoyer
// sont deux actions humaines distinctes (section 13).
// ============================================================

async function loadOwnedDossierForCommunication(dossierId: string, organisationId: string) {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    select: { id: true, createdById: true, reference: true, client: { select: { prenom: true, nom: true, email: true } }, organisation: { select: { nom: true } } },
  });
  if (!dossier) throw new Error("Dossier introuvable.");
  return dossier;
}

export async function prepareDocumentRequestAction(dossierId: string): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const dossier = await loadOwnedDossierForCommunication(dossierId, ctx.organisationId);
    if (!canAccessDossierCommunication(ctx, dossier)) throw new Error("Accès refusé.");

    const built = await buildMissingDocumentsMessage(dossierId, ctx.organisationId);
    if (!built.destinataire) throw new Error("Aucune adresse email connue pour ce client.");
    const template = await getEmailTemplate("DEMANDE_PIECES", ctx.organisationId);

    const draftId = await createEmailDraft({
      organisationId: ctx.organisationId,
      templateId: template.id,
      dossierId,
      destinataire: built.destinataire,
      sujet: built.sujet,
      corps: built.corps,
      createdById: ctx.userId,
    });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, draftId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function prepareTemplateEmailAction(dossierId: string, templateCode: string): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const dossier = await loadOwnedDossierForCommunication(dossierId, ctx.organisationId);
    if (!canAccessDossierCommunication(ctx, dossier)) throw new Error("Accès refusé.");
    if (!dossier.client.email) throw new Error("Aucune adresse email connue pour ce client.");

    const template = await getEmailTemplate(templateCode, ctx.organisationId);
    const variables: TemplateVariables = {
      "client.prenom": dossier.client.prenom,
      "client.nom": dossier.client.nom,
      "dossier.reference": dossier.reference,
      "organisation.nom": dossier.organisation.nom,
    };
    const draftId = await createEmailDraft({
      organisationId: ctx.organisationId,
      templateId: template.id,
      dossierId,
      destinataire: dossier.client.email,
      sujet: renderTemplate(template.sujetTemplate, variables),
      corps: renderTemplate(template.bodyTemplate, variables),
      createdById: ctx.userId,
    });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, draftId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function sendDraftAction(draftId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "SEND_EMAIL_ACTION")) throw new Error("Accès refusé.");
    const draft = await prisma.emailDraft.findFirst({ where: { id: draftId, organisationId: ctx.organisationId } });
    if (!draft) throw new Error("Brouillon introuvable.");
    if (draft.dossierId) {
      const dossier = await loadOwnedDossierForCommunication(draft.dossierId, ctx.organisationId);
      if (!canAccessDossierCommunication(ctx, dossier)) throw new Error("Accès refusé.");
    }

    const result = await sendEmailDraft(draftId, ctx.organisationId, ctx.userId);
    if (draft.dossierId) revalidatePath(`/dossiers/${draft.dossierId}`);
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Échec de l'envoi." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
