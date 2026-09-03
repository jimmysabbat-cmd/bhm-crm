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

const STATUTS_ANAH = [
  { key: "EN_COURS", label: "En cours" },
  { key: "DEPOSE_PAR_DEMANDEUR", label: "Déposé par le demandeur" },
  { key: "EN_COURS_INSTRUCTION", label: "En cours d'instruction" },
  { key: "ACCEPTE", label: "Accepté" },
  { key: "DEMANDE_AVANCE_DEPOSEE", label: "Demande avance déposée" },
  { key: "DEMANDE_AVANCE_PAYEE", label: "Demande avance payée" },
  { key: "DEMANDE_SOLDE_DEPOSEE", label: "Demande solde déposée" },
  { key: "DEMANDE_SOLDE_PAYEE", label: "Demande de solde payée" },
];

const STATUTS_CEE = [
  { key: "A_ETUDIER", label: "À étudier" },
  { key: "ELIGIBILITE_A_CONFIRMER", label: "Éligibilité à confirmer" },
  { key: "ELIGIBLE", label: "Éligible" },
  { key: "NON_ELIGIBLE", label: "Non éligible" },
  { key: "A_DEPOSER", label: "À déposer" },
  { key: "DEPOSE", label: "Déposé" },
  { key: "EN_CONTROLE", label: "En contrôle" },
  { key: "VALIDE", label: "Validé" },
  { key: "REFUSE", label: "Refusé" },
  { key: "A_FACTURER", label: "À facturer" },
  { key: "PAIEMENT_EN_ATTENTE", label: "Paiement en attente" },
  { key: "PAYE", label: "Payé" },
];

const STATUTS_TRAVAUX = [
  { key: "A_VISITER", label: "À visiter" },
  { key: "VISITE_PLANIFIEE", label: "Visite planifiée" },
  { key: "VISITE_EFFECTUEE", label: "Visite effectuée" },
  { key: "VALIDE_TECHNIQUEMENT", label: "Validé techniquement" },
  { key: "A_PLANIFIER", label: "À planifier" },
  { key: "PLANIFIE", label: "Planifié" },
  { key: "MATERIEL_A_COMMANDER", label: "Matériel à commander" },
  { key: "MATERIEL_COMMANDE", label: "Matériel commandé" },
  { key: "CHANTIER_EN_COURS", label: "Chantier en cours" },
  { key: "CHANTIER_TERMINE", label: "Chantier terminé" },
  { key: "RESERVES", label: "Réserves" },
  { key: "CONTROLE", label: "Contrôle" },
  { key: "CONFORME", label: "Conforme" },
  { key: "SAV", label: "SAV" },
];

async function main() {
  const organisation = await prisma.organisation.upsert({
    where: { slug: "bhm" },
    update: {},
    create: { nom: "Le Bonheur d'Habiter Mieux", slug: "bhm" },
  });

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
  for (let i = 0; i < STATUTS_ANAH.length; i++) {
    const item = STATUTS_ANAH[i];
    await prisma.statutAnah.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }
  for (let i = 0; i < STATUTS_CEE.length; i++) {
    const item = STATUTS_CEE[i];
    await prisma.statutCee.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }
  for (let i = 0; i < STATUTS_TRAVAUX.length; i++) {
    const item = STATUTS_TRAVAUX[i];
    await prisma.statutTravaux.upsert({
      where: { key: item.key },
      update: { label: item.label },
      create: { key: item.key, label: item.label, ordre: i },
    });
  }

  console.log(
    "Listes de paramétrage prêtes (types, statuts, modes de paiement, statuts ANAH/CEE/travaux)."
  );

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
      organisationId: organisation.id,
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
