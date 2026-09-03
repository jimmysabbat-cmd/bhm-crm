"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { assertRuleVersionEditable } from "@/lib/reglementaire/engine";

async function requireManageReglementation() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "MANAGE_REGLEMENTATION")) {
    throw new Error("Accès réservé à la direction (permission MANAGE_REGLEMENTATION).");
  }
  return ctx;
}

/** Publier une version (section 32) - réservé à MANAGE_REGLEMENTATION. Idempotent. */
export async function publierVersionReglementaire(versionId: string) {
  const ctx = await requireManageReglementation();
  const version = await prisma.regleReglementaireVersion.findUnique({ where: { id: versionId }, include: { regle: true } });
  if (!version) throw new Error("Version réglementaire introuvable.");
  if (version.publie) return;

  await prisma.regleReglementaireVersion.update({ where: { id: versionId }, data: { publie: true } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "RegleReglementaireVersion",
    entityId: versionId,
    action: "PUBLIER",
    metadata: { code: version.regle.code, numeroVersion: version.numeroVersion },
  });

  revalidatePath("/parametrage/reglementaire");
}

/**
 * Modifier une valeur de barème (section 6/32) - refusé si la version est
 * déjà publiée (TEST C, section 28 : "version publiée utilisée : impossible
 * de modifier paramètres structurels").
 */
export async function modifierBaremeReglementaire(baremeId: string, formData: FormData) {
  const ctx = await requireManageReglementation();
  const bareme = await prisma.baremeReglementaire.findUnique({ where: { id: baremeId }, include: { ruleVersion: true } });
  if (!bareme) throw new Error("Valeur de barème introuvable.");
  assertRuleVersionEditable(bareme.ruleVersion);

  const valeur = Number(formData.get("valeur"));
  if (!Number.isFinite(valeur)) throw new Error("Valeur de barème invalide.");

  const valeurAvant = bareme.valeur;
  await prisma.baremeReglementaire.update({ where: { id: baremeId }, data: { valeur } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "BaremeReglementaire",
    entityId: baremeId,
    action: "MODIFIER",
    metadata: { cle: bareme.cle, valeurAvant, valeurApres: valeur },
  });

  revalidatePath("/parametrage/reglementaire");
}
