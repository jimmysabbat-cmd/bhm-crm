import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

// ============================================================
// Bootstrap du PREMIER PLATFORM SUPER ADMIN (P12, sections 29/30).
// - Refuse s'il existe déjà un PLATFORM SUPER ADMIN, sauf
//   PLATFORM_FORCE_BOOTSTRAP=true explicitement défini (procédure
//   contrôlée, jamais le chemin normal).
// - Ne transforme JAMAIS automatiquement un utilisateur réel existant :
//   crée toujours un compte DÉDIÉ.
// - Email/mot de passe/nom viennent EXCLUSIVEMENT de variables
//   d'environnement (jamais en dur dans Git) :
//     PLATFORM_ADMIN_EMAIL
//     PLATFORM_ADMIN_PASSWORD
//     PLATFORM_ADMIN_NAME (optionnel)
// - Le mot de passe n'est jamais loggé.
//
// Usage :
//   PLATFORM_ADMIN_EMAIL=jimmy@... PLATFORM_ADMIN_PASSWORD=... npm run platform:create-admin
// ============================================================

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME?.trim() || "Platform Super Admin";

  if (!email || !password) {
    console.error("PLATFORM_ADMIN_EMAIL et PLATFORM_ADMIN_PASSWORD sont obligatoires (variables d'environnement, jamais en argument visible).");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("PLATFORM_ADMIN_PASSWORD doit faire au moins 12 caractères (compte le plus sensible de la plateforme).");
    process.exitCode = 1;
    return;
  }

  const existingSuperAdmin = await prisma.user.findFirst({ where: { isPlatformSuperAdmin: true }, select: { id: true, email: true } });
  const force = process.env.PLATFORM_FORCE_BOOTSTRAP === "true";
  if (existingSuperAdmin && !force) {
    console.error(`Un PLATFORM SUPER ADMIN existe déjà (${existingSuperAdmin.email}). Relancer avec PLATFORM_FORCE_BOOTSTRAP=true pour en créer un second - procédure exceptionnelle, hors parcours normal (section 30).`);
    process.exitCode = 1;
    return;
  }

  const alreadyUser = await prisma.user.findUnique({ where: { email } });
  if (alreadyUser) {
    console.error("Un compte existe déjà avec cet email - choisir une autre adresse dédiée au platform admin.");
    process.exitCode = 1;
    return;
  }

  // organisationId reste null : un PLATFORM SUPER ADMIN n'a besoin d'aucun
  // tenant d'ancrage (organisationId est nullable pour ce cas précis - voir
  // schema.prisma). role garde la valeur par défaut du schéma (COMMERCIAL,
  // la moins privilégiée) : elle n'est de toute façon jamais lue pour un
  // compte sans organisation, requireUserContext() refusant ce cas pour
  // tout utilisateur non-platform-admin.
  const hashed = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { name, email, password: hashed, organisationId: null, actif: true, isPlatformSuperAdmin: true },
  });

  console.log(`Platform Super Admin créé : ${admin.email} (id ${admin.id}).`);
  console.log("Le mot de passe n'est pas ré-affiché - conservez-le dans votre gestionnaire de secrets.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
