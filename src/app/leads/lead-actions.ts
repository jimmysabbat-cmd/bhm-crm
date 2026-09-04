"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { normalizePhoneNumber } from "@/lib/phone";
import { createLeadFromSource, ensureDraftDossierForLead } from "@/lib/leads/conversion";
import type { PotentialDuplicate } from "@/lib/leads/dedup";
import { calculateLeadQualification, type LeadQualificationResult } from "@/lib/leads/qualification";
import { mapReponsesToStructuredFields, type MappableAnswer } from "@/lib/questionnaire/mapping";
import { runDossierStudy } from "@/lib/etude/engine";
import { sanitizeStudyResultForRole, type RedactedStudyResult } from "@/lib/etude/redact";
import type { Prisma } from "@/generated/prisma/client";

const CLAIM_DUREE_MINUTES = 15;

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

async function loadOwnedLead(leadId: string, organisationId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId } });
  if (!lead) throw new Error("Lead introuvable.");
  return lead;
}

/** Crée un lead depuis le formulaire de création rapide - ne bloque jamais sur un doublon potentiel (section 15), le signale seulement. */
export async function creerLead(formData: FormData): Promise<{ ok: true; leadId: string; duplicates: PotentialDuplicate[] } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "MANAGE_LEADS")) throw new Error("Accès refusé.");

    const prenom = str(formData, "prenom");
    const nom = str(formData, "nom");
    if (!prenom || !nom) throw new Error("Prénom et nom sont obligatoires.");

    const assignerAMoi = ["COMMERCIAL", "TELEPROSPECTEUR"].includes(ctx.role);
    const { leadId, duplicates } = await createLeadFromSource({
      organisationId: ctx.organisationId,
      createdById: ctx.userId,
      sourceKey: str(formData, "source"),
      sourceDetail: str(formData, "sourceDetail"),
      prenom,
      nom,
      telephone: str(formData, "telephone"),
      email: str(formData, "email"),
      adresse: str(formData, "adresse"),
      codePostal: str(formData, "codePostal"),
      ville: str(formData, "ville"),
      commercialId: ctx.role === "COMMERCIAL" && assignerAMoi ? ctx.userId : null,
      teleprospecteurId: ctx.role === "TELEPROSPECTEUR" && assignerAMoi ? ctx.userId : null,
      notes: str(formData, "notes"),
    });

    revalidatePath("/leads");
    return { ok: true, leadId, duplicates };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Mise à jour rapide des champs de contact/statut/température/notes (section 6, section A). */
export async function updateLead(leadId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const telephone = str(formData, "telephone");
    const statutKeyRaw = str(formData, "statutKey");
    const statut = statutKeyRaw ? await prisma.leadPipelineStatus.findUnique({ where: { key: statutKeyRaw } }) : null;

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        prenom: str(formData, "prenom") ?? lead.prenom,
        nom: str(formData, "nom") ?? lead.nom,
        telephone,
        telephoneNormalise: normalizePhoneNumber(telephone),
        email: str(formData, "email"),
        adresse: str(formData, "adresse"),
        codePostal: str(formData, "codePostal"),
        ville: str(formData, "ville"),
        temperature: (str(formData, "temperature") as "FROID" | "TIEDE" | "CHAUD" | null) ?? undefined,
        notes: str(formData, "notes"),
        statutId: statut?.id,
      },
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Assignation d'un lead à un commercial/téléprospecteur (section 34 : réservé à la direction). */
export async function assignLead(leadId: string, params: { commercialId: string | null; teleprospecteurId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "ASSIGN_LEADS")) throw new Error("Accès refusé : réservé à la direction.");
    const lead = await loadOwnedLead(leadId, ctx.organisationId);

    await prisma.lead.update({ where: { id: lead.id }, data: { commercialId: params.commercialId, teleprospecteurId: params.teleprospecteurId } });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Lead",
      entityId: lead.id,
      action: "LEAD_ASSIGNATION_CHANGEE",
      metadata: { commercialId: params.commercialId ?? "", teleprospecteurId: params.teleprospecteurId ?? "" },
    });

    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Claim léger (section 23) : verrouille un lead pour CLAIM_DUREE_MINUTES.
 * Refuse si un autre utilisateur a déjà un claim actif ; expire tout seul
 * (aucune tâche de fond nécessaire, l'expiration est vérifiée à la lecture).
 */
export async function claimLead(leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "VIEW_LEADS")) throw new Error("Accès refusé.");

    const now = new Date();
    if (lead.claimedById && lead.claimedById !== ctx.userId && lead.claimExpiresAt && lead.claimExpiresAt > now) {
      throw new Error("Ce lead est déjà en cours d'appel par un autre utilisateur.");
    }

    const claimExpiresAt = new Date(now.getTime() + CLAIM_DUREE_MINUTES * 60_000);
    await prisma.lead.update({ where: { id: lead.id }, data: { claimedById: ctx.userId, claimedAt: now, claimExpiresAt } });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function releaseClaim(leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (lead.claimedById === ctx.userId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { claimedById: null, claimedAt: null, claimExpiresAt: null } });
    }
    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Enregistre le résultat d'un appel (sections 18/19) : crée
 * l'InteractionCommerciale, applique la proposition du résultat (nouveau
 * statut + délai de rappel) sauf override explicite, et libère le claim
 * (l'appel est terminé).
 */
export async function recordInteraction(leadId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const resultatKey = str(formData, "resultatKey");
    const resultat = resultatKey ? await prisma.resultatAppel.findUnique({ where: { key: resultatKey }, include: { proposeStatut: true } }) : null;

    const type = (str(formData, "type") as "APPEL" | "EMAIL" | "SMS" | "VISITE" | "AUTRE" | null) ?? "APPEL";
    const notes = str(formData, "notes");
    const dureeRaw = str(formData, "dureeMinutes");
    const prochaineActionRaw = str(formData, "prochaineActionAt");

    await prisma.interactionCommerciale.create({
      data: {
        organisationId: ctx.organisationId,
        leadId: lead.id,
        userId: ctx.userId,
        type,
        resultatId: resultat?.id ?? null,
        notes,
        dureeMinutes: dureeRaw ? Number(dureeRaw) : null,
        prochaineActionAt: prochaineActionRaw ? new Date(prochaineActionRaw) : null,
      },
    });

    const statutOverrideKey = str(formData, "statutOverrideKey");
    const nouveauStatut = statutOverrideKey
      ? await prisma.leadPipelineStatus.findUnique({ where: { key: statutOverrideKey } })
      : resultat?.proposeStatut ?? null;

    const prochainContactAt = prochaineActionRaw
      ? new Date(prochaineActionRaw)
      : resultat?.proposeDelaiRappelJours != null
        ? new Date(Date.now() + resultat.proposeDelaiRappelJours * 86_400_000)
        : null;

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        dernierResultatId: resultat?.id ?? undefined,
        statutId: nouveauStatut?.id,
        prochainContactAt,
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Lead",
      entityId: lead.id,
      action: "RESULTAT_APPEL_ENREGISTRE",
      metadata: { resultat: resultatKey ?? "", nouveauStatut: nouveauStatut?.key ?? "" },
    });

    revalidatePath(`/leads/${leadId}/qualification`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

type QuestionnaireAnswerInput = {
  questionId: string;
  valeurTexte?: string | null;
  valeurNombre?: number | null;
  valeurBool?: boolean | null;
  valeurDate?: string | null;
  valeurOptions?: string[] | null;
};

/**
 * Enregistre les réponses au questionnaire de qualification (sections 7/8)
 * et applique immédiatement le mapping vers Logement (section 10) - le
 * mapping vers Client (zone climatique, précarité) est recalculé à la
 * conversion (aucun Client n'existe encore avant), jamais dupliqué ici.
 */
export async function saveQuestionnaireAnswers(
  leadId: string,
  questionnaireVersionId: string,
  answers: QuestionnaireAnswerInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "MANAGE_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const reponseQuestionnaire = await prisma.reponseQuestionnaire.upsert({
      where: { leadId_questionnaireVersionId: { leadId: lead.id, questionnaireVersionId } },
      update: {},
      create: { organisationId: ctx.organisationId, leadId: lead.id, questionnaireVersionId },
    });

    for (const a of answers) {
      await prisma.reponseQuestion.upsert({
        where: { reponseQuestionnaireId_questionId: { reponseQuestionnaireId: reponseQuestionnaire.id, questionId: a.questionId } },
        update: {
          valeurTexte: a.valeurTexte ?? null,
          valeurNombre: a.valeurNombre ?? null,
          valeurBool: a.valeurBool ?? null,
          valeurDate: a.valeurDate ? new Date(a.valeurDate) : null,
          valeurOptions: (a.valeurOptions ?? null) as Prisma.InputJsonValue,
        },
        create: {
          reponseQuestionnaireId: reponseQuestionnaire.id,
          questionId: a.questionId,
          valeurTexte: a.valeurTexte ?? null,
          valeurNombre: a.valeurNombre ?? null,
          valeurBool: a.valeurBool ?? null,
          valeurDate: a.valeurDate ? new Date(a.valeurDate) : null,
          valeurOptions: (a.valeurOptions ?? null) as Prisma.InputJsonValue,
        },
      });
    }

    // Mapping immédiat vers Logement (section 10) - recalculé à partir de
    // TOUTES les réponses actuelles du lead, jamais seulement le delta.
    const toutesReponses = await prisma.reponseQuestion.findMany({
      where: { reponseQuestionnaireId: reponseQuestionnaire.id },
      include: { question: { select: { code: true, champMappe: true } } },
    });
    const mappable: MappableAnswer[] = toutesReponses.map((r) => ({
      code: r.question.code,
      champMappe: r.question.champMappe,
      valeurTexte: r.valeurTexte,
      valeurNombre: r.valeurNombre,
      valeurBool: r.valeurBool,
      valeurOptions: (r.valeurOptions as string[] | null) ?? null,
    }));
    const mapping = mapReponsesToStructuredFields(mappable);

    if (Object.keys(mapping.logement).length > 0) {
      const logement = await prisma.logement.upsert({
        where: { leadId: lead.id },
        update: mapping.logement,
        create: { organisationId: ctx.organisationId, leadId: lead.id, ...mapping.logement },
      });

      for (const champ of Object.keys(mapping.logement)) {
        await prisma.champProvenance.upsert({
          where: { logementId_champ: { logementId: logement.id, champ } },
          update: { source: "COMMERCIAL", confiance: "DECLARE" },
          create: { organisationId: ctx.organisationId, logementId: logement.id, champ, source: "COMMERCIAL", confiance: "DECLARE" },
        });
      }
    }

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * "SIMULER L'ÉTUDE" (section 13) - crée le brouillon de dossier si
 * nécessaire (idempotent) puis appelle runDossierStudy (P8) SANS RIEN
 * RECALCULER : aucune formule CEE/financière n'est reproduite ici.
 */
export async function simulerEtudeLead(leadId: string): Promise<{ ok: true; result: RedactedStudyResult; dossierId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "RUN_LEAD_STUDY") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const { dossierId } = await ensureDraftDossierForLead(leadId, ctx);
    const result = await runDossierStudy({ organisationId: ctx.organisationId, dossierId, mode: "SIMULATION" });

    revalidatePath(`/leads/${leadId}/qualification`);
    return { ok: true, result: sanitizeStudyResultForRole(result, ctx), dossierId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Conversion explicite Lead -> Client/Dossier (section 14) - IDEMPOTENTE :
 * réutilise ensureDraftDossierForLead, la même fonction que "Simuler
 * l'étude". Deux clics (ou trois, ou dix) ne créent jamais deux dossiers.
 */
export async function convertLeadToDossier(leadId: string): Promise<{ ok: true; dossierId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "RUN_LEAD_STUDY") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const { dossierId } = await ensureDraftDossierForLead(leadId, ctx);

    revalidatePath(`/leads/${leadId}/qualification`);
    revalidatePath("/leads");
    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, dossierId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function getLeadQualificationForLead(leadId: string): Promise<{ ok: true; qualification: LeadQualificationResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    const lead = await loadOwnedLead(leadId, ctx.organisationId);
    if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) throw new Error("Accès refusé.");

    const [logement, statut, rdv, reponseQuestionnaire] = await Promise.all([
      prisma.logement.findUnique({ where: { leadId } }),
      prisma.leadPipelineStatus.findUniqueOrThrow({ where: { id: lead.statutId } }),
      prisma.rdv.findFirst({ where: { leadId }, orderBy: { date: "desc" } }),
      prisma.reponseQuestionnaire.findFirst({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        include: { questionnaireVersion: { include: { questions: true } }, reponses: true },
      }),
    ]);

    const questionsObligatoires = reponseQuestionnaire?.questionnaireVersion.questions.filter((q) => q.obligatoire) ?? [];
    const reponduIds = new Set((reponseQuestionnaire?.reponses ?? []).map((r) => r.questionId));

    const qualification = calculateLeadQualification({
      pipelineStatutKey: statut.key,
      temperature: lead.temperature,
      aRdvPlanifie: rdv != null && rdv.statut !== "ANNULE",
      logement: logement
        ? { typeBatiment: logement.typeBatiment, surfaceHabitableM2: logement.surfaceHabitableM2, anneeConstruction: logement.anneeConstruction, chauffagePrincipal: logement.chauffagePrincipal }
        : null,
      nbReponsesQuestionnaire: reponseQuestionnaire?.reponses.length ?? 0,
      nbQuestionsObligatoiresTotal: questionsObligatoires.length,
      nbQuestionsObligatoiresRepondues: questionsObligatoires.filter((q) => reponduIds.has(q.id)).length,
    });

    return { ok: true, qualification };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
