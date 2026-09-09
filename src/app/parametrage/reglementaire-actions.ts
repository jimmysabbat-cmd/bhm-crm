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

/**
 * Publier une version (section 32) - réservé à MANAGE_REGLEMENTATION.
 * Idempotent. `publie` et `statutValidation` sont TOUJOURS écrits ensemble
 * (P13, audit SaaS section B) - jamais l'un sans l'autre, pour que
 * getApplicableRuleVersion()/assertRuleVersionUsableForOfficial() restent
 * fiables. Callable directement depuis BROUILLON (l'UI actuelle n'a qu'un
 * seul bouton "Publier") - le pipeline complet BROUILLON→A_VERIFIER→VALIDE
 * (ci-dessous) reste disponible pour une future UI de revue à plusieurs
 * mains, sans être imposé aujourd'hui.
 */
export async function publierVersionReglementaire(versionId: string) {
  const ctx = await requireManageReglementation();
  const version = await prisma.regleReglementaireVersion.findUnique({ where: { id: versionId }, include: { regle: true } });
  if (!version) throw new Error("Version réglementaire introuvable.");
  if (version.publie) return;

  await prisma.regleReglementaireVersion.update({ where: { id: versionId }, data: { publie: true, statutValidation: "PUBLIE" } });

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

/** BROUILLON -> A_VERIFIER (section B) - soumet une version à revue. */
export async function soumettreValidationVersion(versionId: string) {
  const ctx = await requireManageReglementation();
  const version = await prisma.regleReglementaireVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Version réglementaire introuvable.");
  if (version.statutValidation !== "BROUILLON") {
    throw new Error(`Seule une version BROUILLON peut être soumise à validation (statut actuel : ${version.statutValidation}).`);
  }

  await prisma.regleReglementaireVersion.update({ where: { id: versionId }, data: { statutValidation: "A_VERIFIER" } });
  await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "RegleReglementaireVersion", entityId: versionId, action: "SOUMETTRE_VALIDATION" });
  revalidatePath("/parametrage/reglementaire");
}

/** A_VERIFIER -> VALIDE (section B) - trace qui a validé et quand, jamais un simple flag anonyme. */
export async function validerVersionReglementaire(versionId: string) {
  const ctx = await requireManageReglementation();
  const version = await prisma.regleReglementaireVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Version réglementaire introuvable.");
  if (version.statutValidation !== "A_VERIFIER") {
    throw new Error(`Seule une version A_VERIFIER peut être validée (statut actuel : ${version.statutValidation}).`);
  }

  await prisma.regleReglementaireVersion.update({
    where: { id: versionId },
    data: { statutValidation: "VALIDE", validatedById: ctx.userId, validatedAt: new Date() },
  });
  await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "RegleReglementaireVersion", entityId: versionId, action: "VALIDER" });
  revalidatePath("/parametrage/reglementaire");
}

/**
 * Archiver une version (section B) - retire `publie` en plus de passer le
 * statut à ARCHIVE, pour qu'elle ne soit plus jamais sélectionnée par
 * getApplicableRuleVersion() pour un NOUVEAU calcul. N'affecte jamais les
 * CalculReglementaire déjà créés (ils référencent ruleVersionId directement,
 * jamais ré-résolus) - une archive n'est donc jamais rétroactive.
 */
export async function archiverVersionReglementaire(versionId: string) {
  const ctx = await requireManageReglementation();
  const version = await prisma.regleReglementaireVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Version réglementaire introuvable.");
  if (version.statutValidation === "ARCHIVE") return;

  await prisma.regleReglementaireVersion.update({ where: { id: versionId }, data: { statutValidation: "ARCHIVE", publie: false } });
  await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "RegleReglementaireVersion", entityId: versionId, action: "ARCHIVER" });
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
