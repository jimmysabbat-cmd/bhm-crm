import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { seedAutomations } from "../prisma/seed-automations";

// Crée les règles / modèles d'automatisation manquants pour TOUTES les
// sociétés (idempotent : une règle existante n'est jamais modifiée). À
// lancer après chaque déploiement ajoutant de nouvelles règles :
//   npm run automations:seed
async function main() {
  const orgs = await prisma.organisation.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, nom: true } });
  for (const o of orgs) {
    console.log(`→ ${o.nom}`);
    await seedAutomations(prisma as never, o.id);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
