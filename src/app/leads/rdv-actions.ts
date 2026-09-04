"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { changeLeadStatus } from "@/lib/leads/status";

// ============================================================
// RDV (P9, section 17) - reste interne au CRM, aucune intégration Google
// Calendar (section 38).
// ============================================================

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

export async function createRdv(leadId: string, formData: FormData): Promise<{ ok: true; rdvId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const date = str(formData, "date");
    const heure = str(formData, "heure");
    if (!date) throw new Error("Date obligatoire.");
    const dateTime = new Date(`${date}T${heure ?? "09:00"}:00`);

    const rdv = await prisma.rdv.create({
      data: {
        organisationId: ctx.organisationId,
        leadId: lead.id,
        date: dateTime,
        type: (str(formData, "type") as "TELEPHONIQUE" | "VISITE" | "AUTRE" | null) ?? "VISITE",
        commercialId: str(formData, "commercialId") ?? lead.commercialId,
        adresse: str(formData, "adresse") ?? lead.adresse,
        commentaire: str(formData, "commentaire"),
        createdById: ctx.userId,
      },
    });

    const statutRdvPris = await prisma.leadPipelineStatus.findUnique({ where: { key: "RDV_PRIS" } });
    if (statutRdvPris) {
      await changeLeadStatus({ leadId: lead.id, newStatusId: statutRdvPris.id, userId: ctx.userId });
    }

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Rdv", entityId: rdv.id, action: "RDV_CREE", metadata: { leadId: lead.id } });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, rdvId: rdv.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function updateRdvStatut(rdvId: string, statut: "PLANIFIE" | "CONFIRME" | "REALISE" | "ANNULE"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const rdv = await prisma.rdv.findFirst({ where: { id: rdvId, organisationId: ctx.organisationId } });
    if (!rdv) throw new Error("RDV introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS")) throw new Error("Accès refusé.");

    await prisma.rdv.update({ where: { id: rdv.id }, data: { statut } });

    if (statut === "REALISE" && rdv.leadId) {
      const statutVisite = await prisma.leadPipelineStatus.findUnique({ where: { key: "VISITE_EFFECTUEE" } });
      if (statutVisite) await changeLeadStatus({ leadId: rdv.leadId, newStatusId: statutVisite.id, userId: ctx.userId });
    }

    if (rdv.leadId) revalidatePath(`/leads/${rdv.leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
