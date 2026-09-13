"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, isPartnerRole, canAccessPackageAsPartner } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { createMissionPackage, type ChampsClientPartages } from "@/lib/documents/mission";

// ============================================================
// P15 (60 min) - Server Actions "Envoyer en mission" + réponse
// sous-traitant (accepter/refuser). Réutilise TransmissionPackage (P10).
// ============================================================

export async function getSousTraitantsActifsAction(): Promise<{ id: string; nom: string }[]> {
  const ctx = await requireUserContext();
  const list = await prisma.sousTraitant.findMany({
    where: { organisationId: ctx.organisationId, actif: true },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });
  return list;
}

export async function getDossierDocumentsAction(dossierId: string): Promise<{ id: string; nomFichier: string; typeNom: string | null }[]> {
  const ctx = await requireUserContext();
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");
  const docs = await prisma.dossierDocument.findMany({
    where: { dossierId, statut: { not: "REMPLACE" } },
    select: { id: true, nomFichier: true, typeDocumentRef: { select: { nom: true } } },
    orderBy: { createdAt: "desc" },
  });
  return docs.map((d) => ({ id: d.id, nomFichier: d.nomFichier, typeNom: d.typeDocumentRef?.nom ?? null }));
}

export async function envoyerEnMissionAction(input: {
  dossierId: string;
  posteTravauxId: string;
  sousTraitantId: string;
  champsPartages: ChampsClientPartages;
  documentIds: string[];
  dateDebutSouhaitee: string | null;
  dateFinSouhaitee: string | null;
  instructions: string | null;
  prixConvenuCts: number | null;
}): Promise<{ ok: true; packageId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");

    const packageId = await createMissionPackage({
      organisationId: ctx.organisationId,
      dossierId: input.dossierId,
      posteTravauxId: input.posteTravauxId,
      sousTraitantId: input.sousTraitantId,
      champsPartages: input.champsPartages,
      documentIds: input.documentIds,
      dateDebutSouhaitee: input.dateDebutSouhaitee ? new Date(input.dateDebutSouhaitee) : null,
      dateFinSouhaitee: input.dateFinSouhaitee ? new Date(input.dateFinSouhaitee) : null,
      instructions: input.instructions,
      prixConvenuCts: input.prixConvenuCts,
      createdById: ctx.userId,
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "TransmissionPackage",
      entityId: packageId,
      action: "MISSION_ENVOYEE",
      metadata: { dossierId: input.dossierId, posteTravauxId: input.posteTravauxId, sousTraitantId: input.sousTraitantId },
    });

    revalidatePath(`/dossiers/${input.dossierId}`);
    return { ok: true, packageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function loadOwnedMissionAsPartner(packageId: string) {
  const ctx = await requireUserContext();
  if (!isPartnerRole(ctx)) throw new Error("Accès refusé.");
  const pkg = await prisma.transmissionPackage.findFirst({ where: { id: packageId, organisationId: ctx.organisationId } });
  if (!pkg) throw new Error("Mission introuvable.");
  if (!canAccessPackageAsPartner(ctx, pkg)) throw new Error("Accès refusé.");
  return { ctx, pkg };
}

export async function accepterMissionAction(packageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { ctx, pkg } = await loadOwnedMissionAsPartner(packageId);
    if (pkg.status !== "ENVOYEE") throw new Error("Seule une mission envoyée peut être acceptée.");

    await prisma.transmissionPackage.update({
      where: { id: pkg.id },
      data: { status: "ACCEPTEE", respondedAt: new Date(), respondedById: ctx.userId },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "MISSION_ACCEPTEE", metadata: { dossierId: pkg.dossierId } });

    revalidatePath("/partenaire");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function refuserMissionAction(packageId: string, reason: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { ctx, pkg } = await loadOwnedMissionAsPartner(packageId);
    if (pkg.status !== "ENVOYEE") throw new Error("Seule une mission envoyée peut être refusée.");

    await prisma.transmissionPackage.update({
      where: { id: pkg.id },
      data: { status: "REFUSEE", respondedAt: new Date(), respondedById: ctx.userId, refusalReason: reason },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "MISSION_REFUSEE", metadata: { dossierId: pkg.dossierId, reason: reason ?? "" } });

    revalidatePath("/partenaire");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
