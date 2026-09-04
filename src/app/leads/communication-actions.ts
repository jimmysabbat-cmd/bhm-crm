"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { createEmailDraft, getEmailTemplate, sendEmailDraft } from "@/lib/email/service";
import { renderTemplate, type TemplateVariables } from "@/lib/automations/templates";

// ============================================================
// Communications lead (P11, section 22) - préparer email, confirmation
// RDV, relance devis. Pas de SMS/WhatsApp en P11 (hors périmètre).
// ============================================================

async function loadOwnedLeadForCommunication(leadId: string, organisationId: string, ctx: Awaited<ReturnType<typeof requireUserContext>>) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organisationId },
    select: { id: true, prenom: true, nom: true, email: true, commercialId: true, teleprospecteurId: true, createdById: true, dossierId: true, organisation: { select: { nom: true } } },
  });
  if (!lead || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");
  return lead;
}

export async function prepareLeadTemplateEmailAction(leadId: string, templateCode: string): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "PREPARE_COMMUNICATIONS")) throw new Error("Accès refusé.");
    const lead = await loadOwnedLeadForCommunication(leadId, ctx.organisationId, ctx);
    if (!lead.email) throw new Error("Aucune adresse email connue pour ce lead.");

    const template = await getEmailTemplate(templateCode, ctx.organisationId);
    const variables: TemplateVariables = {
      "client.prenom": lead.prenom,
      "client.nom": lead.nom,
      "organisation.nom": lead.organisation.nom,
    };
    const draftId = await createEmailDraft({
      organisationId: ctx.organisationId,
      templateId: template.id,
      leadId,
      destinataire: lead.email,
      sujet: renderTemplate(template.sujetTemplate, variables),
      corps: renderTemplate(template.bodyTemplate, variables),
      createdById: ctx.userId,
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, draftId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function sendLeadDraftAction(draftId: string, leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "SEND_EMAIL_ACTION")) throw new Error("Accès refusé.");
    await loadOwnedLeadForCommunication(leadId, ctx.organisationId, ctx);
    const result = await sendEmailDraft(draftId, ctx.organisationId, ctx.userId);
    revalidatePath(`/leads/${leadId}/qualification`);
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Échec de l'envoi." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
