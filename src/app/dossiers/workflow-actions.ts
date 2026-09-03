"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { recalculateDossierWorkflow } from "@/lib/workflow";

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

export async function terminerEtape(dossierEtapeId: string) {
  const ctx = await requireUserContext();
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
