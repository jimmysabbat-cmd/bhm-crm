"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, assertDossierInOrg } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { eurosToCents } from "@/lib/money";
import { computeMouvementAuditDiff } from "@/lib/financial-engine";

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

// Convertit un champ <select> optionnel (payeurType/beneficiaireType/
// exigibleQuand) - chaîne vide = non renseigné (null), jamais une valeur
// d'enum inventée.
function optionalEnumValue(value: FormDataEntryValue | null): never {
  return ((value && String(value).trim() !== "" ? String(value) : null) as unknown) as never;
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
      payeurType: optionalEnumValue(formData.get("payeurType")),
      beneficiaireType: optionalEnumValue(formData.get("beneficiaireType")),
      exigibleQuand: optionalEnumValue(formData.get("exigibleQuand")),
      montantPrevuCts: optionalEurosToCents(formData.get("montantPrevu")),
      montantReelCts: optionalEurosToCents(formData.get("montantReel")),
      datePrevue: optionalDate(formData.get("datePrevue")),
      dateReelle: optionalDate(formData.get("dateReelle")),
      statut: (formData.get("statut") as never) || "PREVU",
      origine: (formData.get("origine") as string) || null,
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

  const apres = {
    montantPrevuCts: optionalEurosToCents(formData.get("montantPrevu")),
    montantReelCts: optionalEurosToCents(formData.get("montantReel")),
    datePrevue: optionalDate(formData.get("datePrevue")),
    dateReelle: optionalDate(formData.get("dateReelle")),
  };

  await prisma.mouvementFinancier.update({
    where: { id: before.id },
    data: {
      type: formData.get("type") as never,
      categorie: formData.get("categorie") as never,
      payeur: (formData.get("payeur") as string) || null,
      beneficiaire: (formData.get("beneficiaire") as string) || null,
      payeurType: optionalEnumValue(formData.get("payeurType")),
      beneficiaireType: optionalEnumValue(formData.get("beneficiaireType")),
      exigibleQuand: optionalEnumValue(formData.get("exigibleQuand")),
      montantPrevuCts: apres.montantPrevuCts,
      montantReelCts: apres.montantReelCts,
      datePrevue: apres.datePrevue,
      dateReelle: apres.dateReelle,
      statut: (formData.get("statut") as never) || before.statut,
      origine: (formData.get("origine") as string) || null,
      commentaire: (formData.get("commentaire") as string) || null,
    },
  });

  // Section 25 : toute modification de montant ou de date doit être
  // traçable avant/après dans le metadata de l'AuditLog (logique partagée et
  // testée indépendamment dans financial-engine.ts).
  const metadata: Record<string, string | number | boolean | null> = {
    dossierId: before.dossierId,
    ...computeMouvementAuditDiff(before, apres),
  };

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "MouvementFinancier",
    entityId: before.id,
    action: "MODIFIER",
    metadata,
  });

  revalidatePath(`/dossiers/${before.dossierId}`);
}

async function marquerStatut(mouvementId: string, organisationId: string, userId: string, statut: "RECU" | "PAYE") {
  const before = await loadOwnedMouvement(mouvementId, organisationId);
  const montantReelApresCts = before.montantReelCts ?? before.montantPrevuCts ?? 0;

  await prisma.mouvementFinancier.update({
    where: { id: before.id },
    data: {
      statut,
      dateReelle: new Date(),
      montantReelCts: montantReelApresCts,
    },
  });

  await logAudit({
    organisationId,
    userId,
    entityType: "MouvementFinancier",
    entityId: before.id,
    action: statut === "RECU" ? "MARQUER_RECU" : "MARQUER_PAYE",
    metadata: {
      dossierId: before.dossierId,
      categorie: before.categorie,
      montantReelAvantCts: before.montantReelCts ?? 0,
      montantReelApresCts,
    },
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
