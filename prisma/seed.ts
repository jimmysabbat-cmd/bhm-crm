import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfigFromUrl } from "../src/lib/db-config";
import { seedBaseReferentiels } from "./seed-base-referentiels";
import { seedReglementaireDemo } from "./seed-reglementaire";
import { seedLeadReferentiels, seedQuestionnaireQualification } from "./seed-leads";
import { seedDocumentReferentiel } from "./seed-documents";
import { seedAutomations } from "./seed-automations";
import bcrypt from "bcryptjs";

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));
const prisma = new PrismaClient({ adapter });

// Programme de démonstration uniquement (seed) - une illustration de ce que
// l'admin peut configurer depuis /parametrage/programmes, PAS une vérité
// métier codée en dur. Le moteur (src/lib/workflow.ts) ignore totalement
// ces valeurs : il ne fait que lire les tables Programme/ProgrammeVersion/
// EtapeProgramme, quel que soit leur contenu.
const ETAPES_DEMO = [
  { code: "DEVIS_SIGNE", nom: "Devis signé", typeFlux: "COMMERCIAL", delaiNormalJours: null, delaiAlerteJours: null, roleResponsable: "COMMERCIAL", dependsOn: [] as string[] },
  { code: "AUDIT_A_REALISER", nom: "Audit à réaliser", typeFlux: "ADMINISTRATIF", delaiNormalJours: 15, delaiAlerteJours: 10, roleResponsable: "TECHNIQUE", dependsOn: ["DEVIS_SIGNE"] },
  { code: "AUDIT_TERMINE", nom: "Audit terminé", typeFlux: "ADMINISTRATIF", delaiNormalJours: 7, delaiAlerteJours: null, roleResponsable: "TECHNIQUE", dependsOn: ["AUDIT_A_REALISER"] },
  { code: "MAR_A_DESIGNER", nom: "MAR à désigner", typeFlux: "ANAH", delaiNormalJours: 5, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["AUDIT_TERMINE"] },
  { code: "DOSSIER_A_PREPARER", nom: "Dossier à préparer", typeFlux: "ANAH", delaiNormalJours: 10, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["MAR_A_DESIGNER"] },
  { code: "DEPOT_ANAH", nom: "Dépôt ANAH", typeFlux: "ANAH", delaiNormalJours: 5, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["DOSSIER_A_PREPARER"] },
  { code: "INSTRUCTION_ANAH", nom: "Instruction ANAH", typeFlux: "ANAH", delaiNormalJours: 60, delaiAlerteJours: 45, roleResponsable: "ADMINISTRATIF", dependsOn: ["DEPOT_ANAH"] },
  { code: "ACCORD_ANAH", nom: "Accord ANAH", typeFlux: "ANAH", delaiNormalJours: 5, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["INSTRUCTION_ANAH"] },
  { code: "FINANCEMENT_A_SECURISER", nom: "Financement / reste à charge à sécuriser", typeFlux: "FINANCIER", delaiNormalJours: 10, delaiAlerteJours: null, roleResponsable: "COMMERCIAL", dependsOn: ["ACCORD_ANAH"] },
  { code: "VISITE_TECHNIQUE", nom: "Visite technique", typeFlux: "TRAVAUX", delaiNormalJours: 15, delaiAlerteJours: null, roleResponsable: "TECHNIQUE", dependsOn: ["ACCORD_ANAH"] },
  { code: "TRAVAUX_A_PLANIFIER", nom: "Travaux à planifier", typeFlux: "TRAVAUX", delaiNormalJours: 10, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["ACCORD_ANAH", "VISITE_TECHNIQUE"] },
  { code: "TRAVAUX_EN_COURS", nom: "Travaux en cours", typeFlux: "TRAVAUX", delaiNormalJours: 30, delaiAlerteJours: null, roleResponsable: "TECHNIQUE", dependsOn: ["TRAVAUX_A_PLANIFIER"] },
  { code: "TRAVAUX_TERMINES", nom: "Travaux terminés", typeFlux: "TRAVAUX", delaiNormalJours: 3, delaiAlerteJours: null, roleResponsable: "TECHNIQUE", dependsOn: ["TRAVAUX_EN_COURS"] },
  { code: "CONTROLE_CONFORMITE", nom: "Contrôle / conformité", typeFlux: "TRAVAUX", delaiNormalJours: 10, delaiAlerteJours: null, roleResponsable: "TECHNIQUE", dependsOn: ["TRAVAUX_TERMINES"] },
  { code: "DEMANDE_SOLDE", nom: "Demande de solde", typeFlux: "ANAH", delaiNormalJours: 5, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["CONTROLE_CONFORMITE"] },
  { code: "ENCAISSEMENT_ANAH", nom: "Encaissement ANAH", typeFlux: "FINANCIER", delaiNormalJours: 30, delaiAlerteJours: 45, roleResponsable: "COMPTABILITE", dependsOn: ["DEMANDE_SOLDE"] },
  { code: "TRAITEMENT_CEE", nom: "Traitement CEE", typeFlux: "CEE", delaiNormalJours: 20, delaiAlerteJours: null, roleResponsable: "ADMINISTRATIF", dependsOn: ["CONTROLE_CONFORMITE"] },
  { code: "ENCAISSEMENT_CEE", nom: "Encaissement CEE", typeFlux: "FINANCIER", delaiNormalJours: 30, delaiAlerteJours: null, roleResponsable: "COMPTABILITE", dependsOn: ["TRAITEMENT_CEE"] },
  { code: "SOLDE_CLIENT", nom: "Solde client", typeFlux: "FINANCIER", delaiNormalJours: 10, delaiAlerteJours: null, roleResponsable: "COMPTABILITE", dependsOn: ["ENCAISSEMENT_ANAH", "ENCAISSEMENT_CEE"] },
  { code: "CLOTURE", nom: "Clôture", typeFlux: "ADMINISTRATIF", delaiNormalJours: 3, delaiAlerteJours: null, roleResponsable: "ADMIN", dependsOn: ["SOLDE_CLIENT"] },
] as const;

// Quelques exemples de tâches automatiques et de documents requis, pour
// illustrer les sections 6 et 7 - pas une liste exhaustive.
const MODELES_TACHES_DEMO: Record<string, { titre: string; type: string; delaiJours: number; roleResponsable: string }[]> = {
  DEPOT_ANAH: [{ titre: "Déposer le dossier sur monANAH", type: "AUTRE", delaiJours: 2, roleResponsable: "ADMINISTRATIF" }],
  INSTRUCTION_ANAH: [{ titre: "Relancer l'instructeur ANAH", type: "RELANCE_ANAH", delaiJours: 30, roleResponsable: "ADMINISTRATIF" }],
  TRAVAUX_A_PLANIFIER: [{ titre: "Planifier la date d'intervention avec le client", type: "RELANCE_CLIENT", delaiJours: 5, roleResponsable: "ADMINISTRATIF" }],
};

const DOCUMENTS_REQUIS_DEMO: Record<string, { typeDocument: string; obligatoire: boolean }[]> = {
  AUDIT_TERMINE: [{ typeDocument: "AUDIT", obligatoire: true }],
  DEPOT_ANAH: [{ typeDocument: "DEVIS", obligatoire: true }],
};

async function seedProgrammeDemo(organisationId: string) {
  const programme = await prisma.programme.upsert({
    where: { organisationId_code: { organisationId, code: "RENOVATION_AMPLEUR_ANAH_DEMO" } },
    update: {},
    create: {
      organisationId,
      nom: "Rénovation d'ampleur ANAH",
      code: "RENOVATION_AMPLEUR_ANAH_DEMO",
      description:
        "Programme de démonstration du moteur de workflow - à adapter ou remplacer depuis /parametrage/programmes.",
    },
  });

  const version = await prisma.programmeVersion.upsert({
    where: { programmeId_numeroVersion: { programmeId: programme.id, numeroVersion: "2026.1" } },
    update: {},
    create: {
      programmeId: programme.id,
      numeroVersion: "2026.1",
      nomVersion: "Version de démonstration",
      dateDebutEffet: new Date("2026-01-01"),
      publie: true,
    },
  });

  const etapesParCode = new Map<string, { id: string }>();
  for (let i = 0; i < ETAPES_DEMO.length; i++) {
    const item = ETAPES_DEMO[i];
    const etape = await prisma.etapeProgramme.upsert({
      where: { programmeVersionId_code: { programmeVersionId: version.id, code: item.code } },
      update: {},
      create: {
        programmeVersionId: version.id,
        code: item.code,
        nom: item.nom,
        ordre: i,
        typeFlux: item.typeFlux as never,
        delaiNormalJours: item.delaiNormalJours,
        delaiAlerteJours: item.delaiAlerteJours,
        roleResponsable: item.roleResponsable as never,
      },
    });
    etapesParCode.set(item.code, etape);
  }

  for (const item of ETAPES_DEMO) {
    const etape = etapesParCode.get(item.code)!;
    for (const dependsOnCode of item.dependsOn) {
      const dependsOnEtape = etapesParCode.get(dependsOnCode)!;
      await prisma.etapeDependance.upsert({
        where: { etapeId_dependsOnEtapeId: { etapeId: etape.id, dependsOnEtapeId: dependsOnEtape.id } },
        update: {},
        create: { etapeId: etape.id, dependsOnEtapeId: dependsOnEtape.id },
      });
    }

    for (const modele of MODELES_TACHES_DEMO[item.code] ?? []) {
      const existant = await prisma.modeleTacheEtape.findFirst({
        where: { etapeProgrammeId: etape.id, titre: modele.titre },
      });
      if (!existant) {
        await prisma.modeleTacheEtape.create({
          data: {
            etapeProgrammeId: etape.id,
            titre: modele.titre,
            type: modele.type as never,
            delaiJours: modele.delaiJours,
            roleResponsable: modele.roleResponsable as never,
          },
        });
      }
    }

    for (const doc of DOCUMENTS_REQUIS_DEMO[item.code] ?? []) {
      await prisma.etapeDocumentRequis.upsert({
        where: {
          etapeProgrammeId_typeDocument: { etapeProgrammeId: etape.id, typeDocument: doc.typeDocument as never },
        },
        update: {},
        create: {
          etapeProgrammeId: etape.id,
          typeDocument: doc.typeDocument as never,
          obligatoire: doc.obligatoire,
        },
      });
    }
  }

  console.log(
    `Programme de démonstration prêt : "${programme.nom}" v${version.numeroVersion} (${ETAPES_DEMO.length} étapes).`
  );
}

async function main() {
  const organisation = await prisma.organisation.upsert({
    where: { slug: "bhm" },
    update: {},
    create: { nom: "Le Bonheur d'Habiter Mieux", slug: "bhm" },
  });

  await seedBaseReferentiels(prisma);

  await seedProgrammeDemo(organisation.id);
  await seedReglementaireDemo(prisma);
  await seedLeadReferentiels(prisma);
  await seedQuestionnaireQualification(prisma);
  await seedDocumentReferentiel(prisma);
  await seedAutomations(prisma, organisation.id);

  // P12 (section 3/41) - AUCUN mot de passe par défaut : un fallback
  // "changeme123" est exactement le type de faille que l'audit go-live
  // doit éliminer (un admin réel avec un mot de passe public/devinable si
  // ce script est un jour relancé sans variable définie). Ce script reste
  // un seed DE DÉVELOPPEMENT (programme démo, réglementaire démo) - jamais
  // à exécuter en production (cf. prisma/seed-production.ts, séparé,
  // volontairement minimal, sans aucune création d'utilisateur).
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD non définis - aucun compte admin créé/modifié (les référentiels ci-dessus ont bien été préparés).");
    return;
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD doit faire au moins 8 caractères.");
  }

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
