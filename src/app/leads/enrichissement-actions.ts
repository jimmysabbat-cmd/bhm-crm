"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { proposerEnrichissementAdresse, reconcilierPropositionChamp, type EnrichissementResult } from "@/lib/leads/enrichissement";

// ============================================================
// Actions serveur d'enrichissement automatique par adresse (P14). Isolation
// tenant stricte : chaque action vérifie organisationId + canAccessLead
// avant toute lecture/écriture.
// ============================================================

export async function lancerEnrichissementAdresse(leadId: string): Promise<{ ok: true; result: EnrichissementResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");
    if (!lead.adresse) throw new Error("Aucune adresse renseignée sur ce lead.");

    const result = await proposerEnrichissementAdresse({
      organisationId: ctx.organisationId,
      leadId: lead.id,
      adresse: lead.adresse,
      codePostal: lead.codePostal,
      ville: lead.ville,
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function confirmerChampPropose(
  leadId: string,
  champProvenanceId: string,
  decision: "ACCEPTER" | "REFUSER",
  valeurCorrigee?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    // Vérifie explicitement que la proposition appartient bien au logement
    // de CE lead - jamais une confiance aveugle dans le seul organisationId
    // (isolation stricte, y compris cross-lead au sein d'un même tenant).
    const champProvenance = await prisma.champProvenance.findFirst({
      where: { id: champProvenanceId, organisationId: ctx.organisationId, logement: { leadId: lead.id } },
    });
    if (!champProvenance) throw new Error("Proposition introuvable pour ce lead.");

    await reconcilierPropositionChamp({
      organisationId: ctx.organisationId,
      champProvenanceId,
      decision,
      valeurCorrigee,
      acceptedByUserId: ctx.userId,
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function getPropositionsEnAttente(leadId: string): Promise<
  { ok: true; propositions: { id: string; champ: string; valeurProposee: string; confiance: string; sourceProposee: string | null }[] } | { ok: false; error: string }
> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const logement = await prisma.logement.findUnique({ where: { leadId } });
    if (!logement) return { ok: true, propositions: [] };

    const champs = await prisma.champProvenance.findMany({
      where: { logementId: logement.id, valeurProposee: { not: null } },
    });

    return {
      ok: true,
      propositions: champs.map((c) => ({ id: c.id, champ: c.champ, valeurProposee: c.valeurProposee!, confiance: c.confiance, sourceProposee: c.sourceProposee })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
