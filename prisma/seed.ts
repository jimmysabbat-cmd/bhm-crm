import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfigFromUrl } from "../src/lib/db-config";
import bcrypt from "bcryptjs";

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));
const prisma = new PrismaClient({ adapter });

const DOSSIER_TYPES = [
  { key: "RENOVATION_AMPLEUR_ANAH", label: "Rénovation d'ampleur (ANAH)" },
  { key: "RENOVATION_AMPLEUR_CEE", label: "Rénovation d'ampleur (CEE seul)" },
  { key: "MONOGESTE", label: "Monogeste" },
];

const DOSSIER_STATUSES = [
  { key: "DEVIS_SIGNE", label: "Devis signé" },
  { key: "AUDIT_FAIT", label: "Audit fait" },
  { key: "DOSSIER_DEPOSE", label: "Dossier déposé" },
  { key: "EN_INSTRUCTION", label: "En instruction" },
  { key: "ACCEPTE", label: "Accepté" },
  { key: "REFUSE", label: "Refusé" },
  { key: "TRAVAUX_PLANIFIES", label: "Travaux planifiés" },
  { key: "TRAVAUX_EN_COURS", label: "Travaux en cours" },
  { key: "TRAVAUX_TERMINES", label: "Travaux terminés" },
  { key: "CONTROLE_EN_COURS", label: "Contrôle en cours" },
  { key: "SOLDE_DEMANDE", label: "Solde demandé" },
  { key: "SOLDE_RECU", label: "Solde reçu" },
  { key: "CLOTURE", label: "Clôturé" },
];

const MODES_PAIEMENT = [
  { key: "CLIENT_AVANCE", label: "Client avance" },
  { key: "AVANCE_30_ANAH", label: "Avance 30% ANAH" },
  { key: "FINANCEMENT_PARTENAIRE", label: "Financement partenaire" },
  { key: "MANDATAIRE_FINANCIER_BHM", label: "Mandataire BHM" },
  { key: "MANDATAIRE_FINANCIER_ANAH", label: "Mandataire financier ANAH" },
];

async function main() {
  for (let i = 0; i < DOSSIER_TYPES.length; i++) {
    const item = DOSSIER_TYPES[i];
    await prisma.dossierType.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }
  for (let i = 0; i < DOSSIER_STATUSES.length; i++) {
    const item = DOSSIER_STATUSES[i];
    await prisma.dossierStatus.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }
  for (let i = 0; i < MODES_PAIEMENT.length; i++) {
    const item = MODES_PAIEMENT[i];
    await prisma.modePaiement.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }
  console.log("Listes de paramétrage prêtes (types, statuts, modes de paiement).");

  const email = process.env.SEED_ADMIN_EMAIL ?? "horizonhabitatenergie@gmail.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Jimmy Sabbath",
      password: hashed,
      role: "ADMIN",
    },
  });

  console.log(`Admin user ready: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
