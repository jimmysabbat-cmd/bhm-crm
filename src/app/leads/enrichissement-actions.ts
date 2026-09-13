"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { proposerEnrichissementAdresse, reconcilierPropositionChamp, reconcilierPlusieursPropositions, proposerChampsDpeChoisi, type EnrichissementResult } from "@/lib/leads/enrichissement";
import type { DpeData } from "@/lib/connectors/types";

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

export type PropositionEnAttente = {
  id: string;
  champ: string;
  valeurProposee: string;
  // P14.1 - SOURCE (d'où vient la proposition, ex. "API") et CONFIANCE
  // (fiabilité FAIBLE/MOYENNE/ELEVEE attribuée par le connecteur à CETTE
  // proposition précise) sont deux informations distinctes, jamais
  // confondues. `sourceProposee` = provenance ; `confianceProposee` =
  // fiabilité. Aucune des deux n'est le statut (porté par la simple
  // présence de la proposition = "à confirmer").
  sourceProposee: string | null;
  confianceProposee: string | null;
};

export async function getPropositionsEnAttente(leadId: string): Promise<{ ok: true; propositions: PropositionEnAttente[] } | { ok: false; error: string }> {
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
      propositions: champs.map((c) => ({
        id: c.id,
        champ: c.champ,
        valeurProposee: c.valeurProposee!,
        sourceProposee: c.sourceProposee,
        confianceProposee: c.confianceProposee,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Confirmation groupée (audit section 5) - réutilise reconcilierPropositionChamp par champ, provenance conservée individuellement. */
export async function confirmerPlusieursChamps(leadId: string, champProvenanceIds: string[]): Promise<{ ok: true; accepted: number } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    // Vérifie que CHAQUE id appartient bien à ce lead avant tout accept en
    // lot - jamais une confiance aveugle dans une liste d'ids fournie par
    // le client (isolation stricte, y compris cross-lead au sein du tenant).
    const valides = await prisma.champProvenance.findMany({
      where: { id: { in: champProvenanceIds }, organisationId: ctx.organisationId, logement: { leadId: lead.id } },
      select: { id: true },
    });

    const { accepted } = await reconcilierPlusieursPropositions({ organisationId: ctx.organisationId, champProvenanceIds: valides.map((v) => v.id), acceptedByUserId: ctx.userId });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, accepted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Choix EXPLICITE d'un candidat DPE parmi plusieurs (audit section 6). Le
 * candidat complet est transmis par le client (déjà affiché à l'écran, issu
 * d'un appel serveur précédent) - jamais re-résolu depuis un simple index
 * pour éviter toute divergence entre ce que le télépro a vu et ce qui est
 * réellement persisté.
 */
export async function choisirDpeCandidat(
  leadId: string,
  dpe: DpeData,
  source: string,
  confiance: "LOW" | "MEDIUM" | "HIGH"
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
    if (!lead) throw new Error("Lead introuvable.");
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    await proposerChampsDpeChoisi({ organisationId: ctx.organisationId, leadId: lead.id, dpe, source, confiance });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
