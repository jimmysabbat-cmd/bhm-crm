"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireInternalUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

// P16 - demande de complément d'information au donneur d'ordre (portail
// DO). Un champ libre volontairement simple (pas de fil de discussion
// structuré en V1) - déclenche DO_COMPLEMENT_REQUIS (email au DO, cf.
// src/lib/automations/triggers.ts::detectDoComplementRequis).
export async function demanderComplementAction(dossierId: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireInternalUserContext();
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

// Décision explicite sur une demande envoyée par un donneur d'ordre :
// ACCEPTE (passe dans « À programmer » côté portail) ou REFUSE avec un motif
// visible par le DO. Remplace le changement de statut manuel sans motif.
export async function deciderDemandeDonneurOrdreAction(
  dossierId: string,
  decision: "ACCEPTE" | "REFUSE",
  motif: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireInternalUserContext();
    const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId, donneurOrdreId: { not: null } } });
    if (!dossier) throw new Error("Dossier introuvable ou sans donneur d'ordre.");
    if (decision === "REFUSE" && !motif.trim()) throw new Error("Motif de refus requis (il sera visible par le donneur d'ordre).");

    const statut = await prisma.dossierStatus.findUniqueOrThrow({ where: { key: decision } });
    await prisma.dossier.update({
      where: { id: dossierId },
      data: { statutId: statut.id, motifRefusDonneurOrdre: decision === "REFUSE" ? motif.trim() : null },
    });
    await prisma.tache.updateMany({
      where: { dossierId, titre: "Nouvelle demande donneur d'ordre à qualifier", statut: { not: "FAIT" } },
      data: { statut: "FAIT" },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Dossier", entityId: dossierId, action: `DEMANDE_DO_${decision}`, metadata: { motif } });

    revalidatePath(`/dossiers/${dossierId}`);
    revalidatePath("/dossiers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
