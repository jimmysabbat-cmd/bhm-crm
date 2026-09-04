import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfigFromUrl } from "../src/lib/db-config";
import { seedBaseReferentiels } from "./seed-base-referentiels";
import { seedReglementaireDemo } from "./seed-reglementaire";
import { seedLeadReferentiels, seedQuestionnaireQualification } from "./seed-leads";
import { seedDocumentReferentiel } from "./seed-documents";

// ============================================================
// Seed PRODUCTION minimal (P12, section 42) - STRICTEMENT séparé de
// prisma/seed.ts (dev/démo : programme d'exemple, réglementaire "démo",
// organisation "bhm" par défaut). Ce script ne contient JAMAIS :
// - de faux client / lead / dossier
// - de compte QA (test-qa-local@bhm-crm.local)
// - de création d'utilisateur / mot de passe d'aucune sorte
// - d'organisation tenant (BHM/RUA se créent depuis /platform, réservé au
//   PLATFORM SUPER ADMIN, après npm run platform:create-admin)
//
// Contenu : uniquement des référentiels PLATFORM_GLOBAL nécessaires au
// fonctionnement de N'IMPORTE QUEL tenant (types/statuts de dossier,
// règles réglementaires CEE publiées, référentiel documentaire, référentiel
// leads, questionnaire de qualification).
// ============================================================

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV !== "production") {
    console.log(`NODE_ENV=${process.env.NODE_ENV ?? "undefined"} - ce script est prévu pour la production mais s'exécute quand même (référentiels globaux uniquement, aucun risque).`);
  }

  await seedBaseReferentiels(prisma);
  await seedReglementaireDemo(prisma);
  await seedLeadReferentiels(prisma);
  await seedQuestionnaireQualification(prisma);
  await seedDocumentReferentiel(prisma);

  console.log("\nSeed production terminé : référentiels plateforme prêts.");
  console.log("Prochaines étapes :");
  console.log("  1. npm run platform:create-admin   (créer le PLATFORM SUPER ADMIN, une seule fois)");
  console.log("  2. Se connecter, aller sur /platform/organisations, créer BHM puis RUA");
  console.log("  3. Inviter le premier admin de chaque tenant depuis /parametrage/equipe (une fois entré dans le tenant)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
