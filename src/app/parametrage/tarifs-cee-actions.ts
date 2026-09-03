"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { eurosToCents } from "@/lib/money";

async function requireManageReglementation() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "MANAGE_REGLEMENTATION")) {
    throw new Error("Accès réservé à la direction (permission MANAGE_REGLEMENTATION).");
  }
  return ctx;
}

function optionalDate(value: FormDataEntryValue | null): Date | null {
  if (!value || String(value).trim() === "") return null;
  return new Date(String(value));
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (!value || String(value).trim() === "") return null;
  return String(value);
}

export async function createTarifDelegataireCee(formData: FormData) {
  const ctx = await requireManageReglementation();
  const delegataireId = String(formData.get("delegataireId"));
  const ficheCode = optionalString(formData.get("ficheCode"));
  const categorie = String(formData.get("categorie"));
  const tauxEuros = Number(formData.get("tauxEurosParMwhc"));
  const dateDebut = optionalDate(formData.get("dateDebut")) ?? new Date();
  const dateFin = optionalDate(formData.get("dateFin"));
  const delaiRaw = optionalString(formData.get("delaiPaiementJours"));

  const tarif = await prisma.tarifDelegataireCee.create({
    data: {
      organisationId: ctx.organisationId,
      delegataireId,
      ficheCode,
      categorie,
      tauxCtsParMwhc: eurosToCents(tauxEuros),
      dateDebut,
      dateFin,
      delaiPaiementJours: delaiRaw ? Number(delaiRaw) : null,
      actif: true,
      commentaire: optionalString(formData.get("commentaire")),
    },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "TarifDelegataireCee",
    entityId: tarif.id,
    action: "CREER",
    metadata: { delegataireId, ficheCode: ficheCode ?? "", categorie, tauxCtsParMwhc: tarif.tauxCtsParMwhc },
  });

  revalidatePath("/parametrage/tarifs-cee");
}

export async function updateTarifDelegataireCee(id: string, formData: FormData) {
  const ctx = await requireManageReglementation();
  const tarif = await prisma.tarifDelegataireCee.findFirst({ where: { id, organisationId: ctx.organisationId } });
  if (!tarif) throw new Error("Tarif délégataire introuvable.");

  const ficheCode = optionalString(formData.get("ficheCode"));
  const categorie = String(formData.get("categorie"));
  const tauxEuros = Number(formData.get("tauxEurosParMwhc"));
  const dateDebut = optionalDate(formData.get("dateDebut")) ?? tarif.dateDebut;
  const dateFin = optionalDate(formData.get("dateFin"));
  const delaiRaw = optionalString(formData.get("delaiPaiementJours"));

  await prisma.tarifDelegataireCee.update({
    where: { id },
    data: {
      ficheCode,
      categorie,
      tauxCtsParMwhc: eurosToCents(tauxEuros),
      dateDebut,
      dateFin,
      delaiPaiementJours: delaiRaw ? Number(delaiRaw) : null,
      commentaire: optionalString(formData.get("commentaire")),
    },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "TarifDelegataireCee",
    entityId: id,
    action: "MODIFIER",
    metadata: { delegataireId: tarif.delegataireId },
  });

  revalidatePath("/parametrage/tarifs-cee");
}

export async function toggleTarifDelegataireCee(id: string, actif: boolean) {
  const ctx = await requireManageReglementation();
  const tarif = await prisma.tarifDelegataireCee.findFirst({ where: { id, organisationId: ctx.organisationId } });
  if (!tarif) throw new Error("Tarif délégataire introuvable.");

  await prisma.tarifDelegataireCee.update({ where: { id }, data: { actif } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "TarifDelegataireCee",
    entityId: id,
    action: actif ? "ACTIVER" : "DESACTIVER",
  });

  revalidatePath("/parametrage/tarifs-cee");
}
