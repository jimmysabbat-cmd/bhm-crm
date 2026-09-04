import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfigFromUrl } from "../src/lib/db-config";
import { seedReglementaireDemo } from "./seed-reglementaire";
import { seedLeadReferentiels, seedQuestionnaireQualification } from "./seed-leads";
import { seedDocumentReferentiel } from "./seed-documents";
import bcrypt from "bcryptjs";

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));
const prisma = new PrismaClient({ adapter });

const DOSSIER_TYPES = [
  { key: "RENOVATION_AMPLEUR_ANAH", label: "Rénovation d'ampleur (ANAH)" },
  { key: "RENOVATION_AMPLEUR_CEE", label: "Rénovation d'ampleur (CEE seul)" },
  { key: "MONOGESTE", label: "Monogeste" },
];

const DOSSIER_STATUSES = [
  // P9 (section 13) : statut additif pour un dossier créé automatiquement
  // depuis un lead au moment de "Simuler l'étude", AVANT tout devis signé -
  // ne réutilise jamais DEVIS_SIGNE, qui affirmerait une signature qui n'a
  // pas eu lieu. Placé en premier (ordre 0) pour précéder logiquement le
  // reste du workflow existant, jamais inséré au milieu de la liste.
  { key: "PROSPECT_ETUDE", label: "Prospect en étude" },
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

  await seedProgrammeDemo(organisation.id);
  await seedReglementaireDemo(prisma);
  await seedLeadReferentiels(prisma);
  await seedQuestionnaireQualification(prisma);
  await seedDocumentReferentiel(prisma);

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
