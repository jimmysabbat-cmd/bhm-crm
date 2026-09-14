"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

// P16 - demande de complément d'information au donneur d'ordre (portail
// DO). Un champ libre volontairement simple (pas de fil de discussion
// structuré en V1) - déclenche DO_COMPLEMENT_REQUIS (email au DO, cf.
// src/lib/automations/triggers.ts::detectDoComplementRequis).
export async function demanderComplementAction(dossierId: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId, donneurOrdreId: { not: null } } });
    if (!dossier) throw new Error("Dossier introuvable ou sans donneur d'ordre.");
    if (!message.trim()) throw new Error("Message requis.");

    await prisma.dossier.update({
      where: { id: dossierId },
      data: { complementDemandeMessage: message.trim(), complementDemandeAt: new Date(), complementReponseMessage: null, complementReponseAt: null },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Dossier", entityId: dossierId, action: "COMPLEMENT_DEMANDE", metadata: { message } });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
