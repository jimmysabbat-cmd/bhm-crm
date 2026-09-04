"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { buildTransmissionPackagePreview, createTransmissionPackage, type TransmissionPackagePreview } from "@/lib/documents/transmission";
import type { DestinationTransmission } from "@/generated/prisma/enums";

// ============================================================
// Server Actions des packages de transmission (P10, sections 16/18/29/30).
// ============================================================

async function loadOwnedDossier(dossierId: string, organisationId: string) {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");
  return dossier;
}

export async function previewTransmissionPackageAction(
  dossierId: string,
  destination: DestinationTransmission
): Promise<{ ok: true; preview: TransmissionPackagePreview } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    await loadOwnedDossier(dossierId, ctx.organisationId);
    const preview = await buildTransmissionPackagePreview({ dossierId, organisationId: ctx.organisationId, destination });
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function createTransmissionPackageAction(
  dossierId: string,
  destination: DestinationTransmission,
  destinationName: string | null,
  comment: string | null
): Promise<{ ok: true; packageId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    await loadOwnedDossier(dossierId, ctx.organisationId);

    const packageId = await createTransmissionPackage({ dossierId, organisationId: ctx.organisationId, destination, destinationName, comment, createdById: ctx.userId });

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: packageId, action: "PACKAGE_CREE", metadata: { dossierId, destination } });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, packageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function loadOwnedPackage(packageId: string, organisationId: string) {
  const pkg = await prisma.transmissionPackage.findFirst({ where: { id: packageId, organisationId } });
  if (!pkg) throw new Error("Package introuvable.");
  return pkg;
}

export async function markTransmissionPackagePret(packageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    const pkg = await loadOwnedPackage(packageId, ctx.organisationId);
    if (pkg.status !== "BROUILLON") throw new Error("Seul un package en brouillon peut passer à PRÊT.");

    await prisma.transmissionPackage.update({ where: { id: pkg.id }, data: { status: "PRET" } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "PACKAGE_PRET", metadata: { dossierId: pkg.dossierId } });

    revalidatePath(`/dossiers/${pkg.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** P10, section 29/30 : marquage manuel TRANSMIS - une API/email pourra plus tard renseigner externalReference automatiquement. */
export async function markTransmissionPackageTransmis(
  packageId: string,
  externalReference: string | null,
  comment: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    const pkg = await loadOwnedPackage(packageId, ctx.organisationId);
    if (pkg.status === "ANNULE") throw new Error("Un package annulé ne peut pas être marqué transmis.");

    await prisma.transmissionPackage.update({
      where: { id: pkg.id },
      data: { status: "TRANSMIS", transmittedAt: new Date(), transmittedById: ctx.userId, externalReference, comment: comment ?? pkg.comment },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "PACKAGE_TRANSMIS", metadata: { dossierId: pkg.dossierId, externalReference: externalReference ?? "" } });

    revalidatePath(`/dossiers/${pkg.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function cancelTransmissionPackage(packageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    const pkg = await loadOwnedPackage(packageId, ctx.organisationId);
    if (pkg.status === "TRANSMIS") throw new Error("Un package déjà transmis ne peut pas être annulé.");

    await prisma.transmissionPackage.update({ where: { id: pkg.id }, data: { status: "ANNULE" } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "PACKAGE_ANNULE", metadata: { dossierId: pkg.dossierId } });

    revalidatePath(`/dossiers/${pkg.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
