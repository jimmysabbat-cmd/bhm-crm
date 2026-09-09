"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { recalculateDossierWorkflow } from "@/lib/workflow";
import { getBlockingConditions, assertUserCanValidateCondition } from "@/lib/workflow-gates";

async function loadOwnedDossierEtape(dossierEtapeId: string, organisationId: string) {
  const dossierEtape = await prisma.dossierEtape.findFirst({
    where: { id: dossierEtapeId, organisationId },
    include: { etapeProgramme: { select: { nom: true, obligatoire: true } } },
  });
  if (!dossierEtape) throw new Error("Étape de dossier introuvable.");
  return dossierEtape;
}

async function applyTransition(
  dossierEtapeId: string,
  organisationId: string,
  userId: string,
  action: string,
  data: Parameters<typeof prisma.dossierEtape.update>[0]["data"]
) {
  const before = await loadOwnedDossierEtape(dossierEtapeId, organisationId);
  const after = await prisma.dossierEtape.update({ where: { id: before.id }, data });

  await logAudit({
    organisationId,
    userId,
    entityType: "DossierEtape",
    entityId: before.id,
    action,
    metadata: {
      dossierId: before.dossierId,
      etape: before.etapeProgramme.nom,
      statutAvant: before.statut,
      statutApres: after.statut,
    },
  });

  await recalculateDossierWorkflow(before.dossierId);
  revalidatePath(`/dossiers/${before.dossierId}`);
  return after;
}

export async function demarrerEtape(dossierEtapeId: string) {
  const ctx = await requireUserContext();
  await applyTransition(dossierEtapeId, ctx.organisationId, ctx.userId, "DEMARRER", {
    statut: "EN_COURS",
    dateDebut: new Date(),
  });
}

/**
 * (P10 section 12 + P13 audit SaaS section D) Une étape ne peut être
 * terminée que si ses exigences BLOQUANTES sont satisfaites - documents
 * (DocumentRequirement.blocking=true) ET conditions externes/de validation
 * (EtapeCondition.obligatoire+bloquant=true), jamais un blocage par
 * défaut, seulement quand explicitement configuré pour cette étape.
 * getBlockingConditions() unifie les deux sources, jamais deux vérifications
 * séparées à maintenir.
 */
export async function terminerEtape(dossierEtapeId: string) {
  const ctx = await requireUserContext();
  const before = await loadOwnedDossierEtape(dossierEtapeId, ctx.organisationId);

  const blocages = await getBlockingConditions(before.dossierId, before.etapeProgrammeId, ctx.organisationId);
  if (blocages.length > 0) {
    throw new Error(`Étape bloquée : ${blocages.map((b) => b.libelle).join(", ")}.`);
  }

  await applyTransition(dossierEtapeId, ctx.organisationId, ctx.userId, "TERMINER", {
    statut: "TERMINE",
    dateTerminee: new Date(),
  });
}

export async function bloquerEtape(dossierEtapeId: string, formData: FormData) {
  const ctx = await requireUserContext();
  const raison = (formData.get("raison") as string) || null;
  await applyTransition(dossierEtapeId, ctx.organisationId, ctx.userId, "BLOQUER", {
    statut: "BLOQUE",
    bloque: true,
    raisonBlocage: raison,
  });
}

export async function debloquerEtape(dossierEtapeId: string) {
  const ctx = await requireUserContext();
  const before = await loadOwnedDossierEtape(dossierEtapeId, ctx.organisationId);
  const statutRetour = before.dateDebut ? "EN_COURS" : "A_FAIRE";
  await applyTransition(dossierEtapeId, ctx.organisationId, ctx.userId, "DEBLOQUER", {
    statut: statutRetour,
    bloque: false,
    raisonBlocage: null,
  });
}

export async function ignorerEtape(dossierEtapeId: string) {
  const ctx = await requireUserContext();
  const before = await loadOwnedDossierEtape(dossierEtapeId, ctx.organisationId);
  if (before.etapeProgramme.obligatoire) {
    throw new Error("Cette étape est obligatoire et ne peut pas être ignorée.");
  }
  await applyTransition(dossierEtapeId, ctx.organisationId, ctx.userId, "IGNORER", {
    statut: "IGNORE",
  });
}

export async function assignerEtape(dossierEtapeId: string, formData: FormData) {
  const ctx = await requireUserContext();
  const userId = (formData.get("userId") as string) || "";
  const before = await loadOwnedDossierEtape(dossierEtapeId, ctx.organisationId);

  if (userId) {
    const assigne = await prisma.user.findFirst({
      where: { id: userId, organisationId: ctx.organisationId },
      select: { id: true },
    });
    if (!assigne) throw new Error("Utilisateur introuvable.");
  }

  const after = await prisma.dossierEtape.update({
    where: { id: before.id },
    data: { assignedUserId: userId || null },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "DossierEtape",
    entityId: before.id,
    action: "ASSIGNER",
    metadata: { dossierId: before.dossierId, etape: before.etapeProgramme.nom, assignedUserId: after.assignedUserId },
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}

export async function commenterEtape(dossierEtapeId: string, formData: FormData) {
  const ctx = await requireUserContext();
  const commentaire = (formData.get("commentaire") as string) || null;
  const before = await loadOwnedDossierEtape(dossierEtapeId, ctx.organisationId);

  await prisma.dossierEtape.update({
    where: { id: before.id },
    data: { commentaire },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "DossierEtape",
    entityId: before.id,
    action: "COMMENTER",
    metadata: { dossierId: before.dossierId, etape: before.etapeProgramme.nom },
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}

/**
 * Enregistre l'accomplissement manuel d'une EtapeCondition de type
 * VALIDATION_INTERVENANT (P13, audit SaaS section D) - le seul type de
 * condition qui n'est jamais calculable depuis une autre donnée, c'est un
 * fait primitif. Une ligne par (condition, dossier), jamais réécrite en
 * place : on écrase satisfiedAt/satisfiedById/commentaire (upsert) plutôt
 * que d'empiler un historique, la seule trace utile étant "qui a validé en
 * dernier, quand" - contrairement à un CalculReglementaire ou une
 * ProgrammeVersion, ce n'est pas une donnée figée à des fins réglementaires.
 *
 * Sécurité (revue explicite, ne JAMAIS se contenter des seules FK Prisma) :
 * - la condition doit appartenir à un Programme de LA MÊME organisation que
 *   le dossier (jamais un id de condition d'un autre tenant, même si la
 *   contrainte FK seule ne l'empêcherait pas) ;
 * - si un rôle interne responsable est défini, seul ce rôle (ou ADMIN, qui
 *   garde son pouvoir d'override général déjà en place ailleurs dans P12)
 *   peut valider ;
 * - si un rôle PARTENAIRE responsable est défini, seul un utilisateur
 *   réellement rattaché à un Partenaire possédant ce rôle peut valider -
 *   un ADMIN interne ne peut JAMAIS se substituer à l'attestation d'un
 *   partenaire (contrairement au cas interne ci-dessus : on ne peut pas
 *   "fabriquer" qu'un tiers externe a confirmé quelque chose) ;
 * - un document de preuve doit appartenir à CE dossier ET à cette
 *   organisation (jamais un DossierDocument d'un autre dossier, même dans
 *   la même organisation).
 */
export async function validerConditionEtape(dossierId: string, etapeConditionId: string, formData: FormData) {
  const ctx = await requireUserContext();
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");

  const condition = await prisma.etapeCondition.findFirst({
    where: {
      id: etapeConditionId,
      type: "VALIDATION_INTERVENANT",
      etapeProgramme: { programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    },
    select: { id: true, libelle: true, roleResponsable: true, partenaireRoleResponsable: true },
  });
  if (!condition) throw new Error("Condition introuvable dans cette organisation, ou n'est pas une validation manuelle.");

  await assertUserCanValidateCondition(condition, ctx.userId, ctx.effectiveRole ?? ctx.role);

  const preuveDocumentIdRaw = (formData.get("preuveDocumentId") as string) || null;
  let preuveDocumentId: string | null = null;
  if (preuveDocumentIdRaw) {
    const preuve = await prisma.dossierDocument.findFirst({ where: { id: preuveDocumentIdRaw, dossierId, organisationId: ctx.organisationId }, select: { id: true } });
    if (!preuve) throw new Error("Le document de preuve doit appartenir à ce dossier.");
    preuveDocumentId = preuve.id;
  }
  const preuveReference = (formData.get("preuveReference") as string) || null;
  const commentaire = (formData.get("commentaire") as string) || null;

  await prisma.dossierEtapeConditionValidation.upsert({
    where: { etapeConditionId_dossierId: { etapeConditionId, dossierId } },
    create: { etapeConditionId, dossierId, satisfiedAt: new Date(), satisfiedById: ctx.userId, preuveDocumentId, preuveReference, commentaire },
    update: { satisfiedAt: new Date(), satisfiedById: ctx.userId, preuveDocumentId, preuveReference, commentaire },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "EtapeCondition",
    entityId: etapeConditionId,
    action: "VALIDER_CONDITION",
    metadata: { dossierId, libelle: condition.libelle },
  });

  await recalculateDossierWorkflow(dossierId);
  revalidatePath(`/dossiers/${dossierId}`);
}

/**
 * Affecte une ProgrammeVersion à un dossier qui n'en a pas encore, puis
 * instancie immédiatement son workflow. Ne réaffecte jamais un dossier déjà
 * engagé sur une version (la version est figée à l'affectation, cf. schéma).
 */
export async function affecterProgrammeAuDossier(formData: FormData) {
  const ctx = await requireUserContext();
  const dossierId = String(formData.get("dossierId"));
  const programmeVersionId = String(formData.get("programmeVersionId"));
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId: ctx.organisationId },
    select: { id: true, programmeVersionId: true },
  });
  if (!dossier) throw new Error("Dossier introuvable.");
  if (dossier.programmeVersionId) {
    throw new Error("Ce dossier a déjà un programme affecté - il ne peut pas être changé.");
  }

  const version = await prisma.programmeVersion.findFirst({
    where: { id: programmeVersionId, publie: true, programme: { organisationId: ctx.organisationId } },
    select: { id: true, numeroVersion: true, programme: { select: { nom: true } } },
  });
  if (!version) throw new Error("Version de programme introuvable ou non publiée.");

  await prisma.dossier.update({ where: { id: dossierId }, data: { programmeVersionId: version.id } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "Dossier",
    entityId: dossierId,
    action: "AFFECTER_PROGRAMME",
    metadata: { programme: version.programme.nom, version: version.numeroVersion },
  });

  await recalculateDossierWorkflow(dossierId);
  revalidatePath(`/dossiers/${dossierId}`);
}
