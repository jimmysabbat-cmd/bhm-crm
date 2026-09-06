import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

// ============================================================
// Réinitialisation du mot de passe du PLATFORM SUPER ADMIN existant
// (P12, section 30 - procédure exceptionnelle hors parcours normal).
// - Ne crée JAMAIS de nouvel utilisateur.
// - Ne modifie QUE le champ password de l'utilisateur ciblé - jamais
//   organisationId, isPlatformSuperAdmin, role ou tout autre champ.
// - Refuse si l'utilisateur ciblé n'est pas isPlatformSuperAdmin (garde-fou
//   contre un usage accidentel sur un compte tenant).
// - Email/mot de passe viennent EXCLUSIVEMENT de variables d'environnement
//   (jamais en dur dans Git, jamais en argument visible).
// - Le mot de passe n'est jamais loggé.
//
// Usage :
//   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_NEW_PASSWORD=... npx tsx scripts/platform-reset-admin-password.ts
// ============================================================

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_NEW_PASSWORD;

  if (!email || !password) {
    console.error("PLATFORM_ADMIN_EMAIL et PLATFORM_ADMIN_NEW_PASSWORD sont obligatoires (variables d'environnement).");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("PLATFORM_ADMIN_NEW_PASSWORD doit faire au moins 12 caractères.");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isPlatformSuperAdmin: true } });
  if (!user) {
    console.error("Aucun utilisateur avec cet email.");
    process.exitCode = 1;
    return;
  }
  if (!user.isPlatformSuperAdmin) {
    console.error("Ce compte n'est pas un PLATFORM SUPER ADMIN - ce script ne réinitialise que ce type de compte, refus par sécurité.");
    process.exitCode = 1;
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

  console.log(`Mot de passe réinitialisé pour ${user.email} (id ${user.id}).`);
  console.log("Le mot de passe n'est pas ré-affiché - conservez-le dans votre gestionnaire de secrets.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
