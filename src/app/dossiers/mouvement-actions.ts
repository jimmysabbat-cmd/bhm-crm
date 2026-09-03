"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, assertDossierInOrg } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { eurosToCents } from "@/lib/money";

function optionalEurosToCents(value: FormDataEntryValue | null): number | null {
  if (!value || String(value).trim() === "") return null;
  return eurosToCents(Number(value));
}

function optionalDate(value: FormDataEntryValue | null): Date | null {
  if (!value || String(value).trim() === "") return null;
  return new Date(String(value));
}

async function loadOwnedMouvement(mouvementId: string, organisationId: string) {
  const mouvement = await prisma.mouvementFinancier.findFirst({
    where: { id: mouvementId, organisationId },
  });
  if (!mouvement) throw new Error("Mouvement financier introuvable.");
  return mouvement;
}

export async function createMouvementFinancier(formData: FormData) {
  const ctx = await requireUserContext();
  const dossierId = String(formData.get("dossierId"));
  await assertDossierInOrg(dossierId, ctx.organisationId);

  const mouvement = await prisma.mouvementFinancier.create({
    data: {
      organisationId: ctx.organisationId,
      dossierId,
      type: formData.get("type") as never,
      categorie: formData.get("categorie") as never,
      payeur: (formData.get("payeur") as string) || null,
      beneficiaire: (formData.get("beneficiaire") as string) || null,
      montantPrevuCts: optionalEurosToCents(formData.get("montantPrevu")),
      montantReelCts: optionalEurosToCents(formData.get("montantReel")),
      datePrevue: optionalDate(formData.get("datePrevue")),
      dateReelle: optionalDate(formData.get("dateReelle")),
      statut: (formData.get("statut") as never) || "PREVU",
      commentaire: (formData.get("commentaire") as string) || null,
      createdById: ctx.userId,
    },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "MouvementFinancier",
    entityId: mouvement.id,
    action: "CREER",
    metadata: { dossierId, categorie: mouvement.categorie, montantPrevuCts: mouvement.montantPrevuCts ?? 0 },
  });

  revalidatePath(`/dossiers/${dossierId}`);
}

export async function updateMouvementFinancier(mouvementId: string, formData: FormData) {
  const ctx = await requireUserContext();
  const before = await loadOwnedMouvement(mouvementId, ctx.organisationId);

  await prisma.mouvementFinancier.update({
    where: { id: before.id },
    data: {
      type: formData.get("type") as never,
      categorie: formData.get("categorie") as never,
      payeur: (formData.get("payeur") as string) || null,
      beneficiaire: (formData.get("beneficiaire") as string) || null,
      montantPrevuCts: optionalEurosToCents(formData.get("montantPrevu")),
      montantReelCts: optionalEurosToCents(formData.get("montantReel")),
      datePrevue: optionalDate(formData.get("datePrevue")),
      dateReelle: optionalDate(formData.get("dateReelle")),
      statut: (formData.get("statut") as never) || before.statut,
      commentaire: (formData.get("commentaire") as string) || null,
    },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "MouvementFinancier",
    entityId: before.id,
    action: "MODIFIER",
    metadata: { dossierId: before.dossierId },
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}

async function marquerStatut(mouvementId: string, organisationId: string, userId: string, statut: "RECU" | "PAYE") {
  const before = await loadOwnedMouvement(mouvementId, organisationId);

  await prisma.mouvementFinancier.update({
    where: { id: before.id },
    data: {
      statut,
      dateReelle: new Date(),
      montantReelCts: before.montantReelCts ?? before.montantPrevuCts ?? 0,
    },
  });

  await logAudit({
    organisationId,
    userId,
    entityType: "MouvementFinancier",
    entityId: before.id,
    action: statut === "RECU" ? "MARQUER_RECU" : "MARQUER_PAYE",
    metadata: { dossierId: before.dossierId, categorie: before.categorie },
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}

export async function marquerMouvementRecu(mouvementId: string) {
  const ctx = await requireUserContext();
  await marquerStatut(mouvementId, ctx.organisationId, ctx.userId, "RECU");
}

export async function marquerMouvementPaye(mouvementId: string) {
  const ctx = await requireUserContext();
  await marquerStatut(mouvementId, ctx.organisationId, ctx.userId, "PAYE");
}

export async function annulerMouvementFinancier(mouvementId: string) {
  const ctx = await requireUserContext();
  const before = await loadOwnedMouvement(mouvementId, ctx.organisationId);

  await prisma.mouvementFinancier.update({ where: { id: before.id }, data: { statut: "ANNULE" } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "MouvementFinancier",
    entityId: before.id,
    action: "ANNULER",
    metadata: { dossierId: before.dossierId, categorie: before.categorie },
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}
