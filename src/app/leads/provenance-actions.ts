"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

// ============================================================
// Acceptation/refus d'une donnée externe proposée (P9, sections 29/30).
// Une valeur proposée par un connecteur n'écrase JAMAIS silencieusement la
// valeur courante : ces deux actions sont le SEUL chemin qui permet à une
// valeur proposée de devenir la valeur réelle du logement, toujours
// déclenché explicitement par un humain, jamais automatiquement.
// ============================================================

function coerceProposedValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== "") return n;
  return raw;
}

async function loadOwnedChampProvenance(id: string, organisationId: string) {
  const cp = await prisma.champProvenance.findFirst({ where: { id, organisationId }, include: { logement: true } });
  if (!cp) throw new Error("Donnée introuvable.");
  return cp;
}

export async function acceptProposedValue(champProvenanceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_LEADS")) throw new Error("Accès refusé.");
    const cp = await loadOwnedChampProvenance(champProvenanceId, ctx.organisationId);
    if (!cp.valeurProposee) throw new Error("Aucune proposition en attente pour ce champ.");

    await prisma.logement.update({
      where: { id: cp.logementId },
      data: { [cp.champ]: coerceProposedValue(cp.valeurProposee) as Prisma.InputJsonValue },
    });

    await prisma.champProvenance.update({
      where: { id: cp.id },
      data: {
        source: cp.sourceProposee ?? cp.source,
        confiance: "ESTIME",
        accepteeById: ctx.userId,
        accepteeAt: new Date(),
        refuseeAt: null,
      },
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "ChampProvenance",
      entityId: cp.id,
      action: "DONNEE_EXTERNE_ACCEPTEE",
      metadata: { champ: cp.champ, valeur: cp.valeurProposee },
    });

    revalidatePath(`/leads/${cp.logement.leadId ?? ""}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function refuseProposedValue(champProvenanceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_LEADS")) throw new Error("Accès refusé.");
    const cp = await loadOwnedChampProvenance(champProvenanceId, ctx.organisationId);

    await prisma.champProvenance.update({
      where: { id: cp.id },
      data: { valeurProposee: null, sourceProposee: null, referenceExterne: null, recupereeAt: null, refuseeAt: new Date() },
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "ChampProvenance",
      entityId: cp.id,
      action: "DONNEE_EXTERNE_REFUSEE",
      metadata: { champ: cp.champ },
    });

    revalidatePath(`/leads/${cp.logement.leadId ?? ""}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
