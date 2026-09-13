import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// ============================================================
// P14.2 - Provisioning DEV/TEST idempotent de 2 FicheMetier génériques
// (PAC_AIR_EAU, ITE) + ArgumentaireMetier associés, pour rendre la
// qualification télépro immédiatement testable dans un tenant réel.
//
// AUCUNE logique métier codée en dur : ce script crée uniquement de la
// CONFIGURATION, exactement ce qu'un tenant pourrait créer lui-même via un
// futur écran Paramétrage. Ne contient aucun montant d'aide, aucun seuil
// réglementaire officiel - uniquement des libellés commerciaux génériques
// et des références à tester par les moteurs (P7/P8), jamais une valeur
// affirmée.
//
// Usage : npx tsx scripts/p14-2-seed-demo-metier.ts <organisationId>
// Idempotent (upsert par [organisationId, code]).
// ============================================================

async function main() {
  const organisationId = process.argv[2];
  if (!organisationId) throw new Error("Usage : npx tsx scripts/p14-2-seed-demo-metier.ts <organisationId>");

  const org = await prisma.organisation.findUnique({ where: { id: organisationId } });
  if (!org) throw new Error(`Organisation ${organisationId} introuvable.`);

  const argPac = await prisma.argumentaireMetier.upsert({
    where: { organisationId_code: { organisationId, code: "PAC_AIR_EAU_DEMO" } },
    update: {},
    create: {
      organisationId,
      typeTravaux: "PAC_AIR_EAU",
      code: "PAC_AIR_EAU_DEMO",
      libelle: "Argumentaire PAC air/eau (configuration DEV/TEST)",
      pourquoi: "Le logement est actuellement chauffé au {{logement.chauffagePrincipal}} - une pompe à chaleur air/eau peut être une alternative à étudier.",
      benefices: "Confort thermique et régulation fine, sortie progressive des énergies fossiles.",
      aConfirmer: "Dimensionnement, température de départ des émetteurs existants, emplacement de l'unité extérieure.",
      prochaineEtape: "Visite technique pour confirmer la faisabilité.",
    },
  });

  const argIte = await prisma.argumentaireMetier.upsert({
    where: { organisationId_code: { organisationId, code: "ITE_DEMO" } },
    update: {},
    create: {
      organisationId,
      typeTravaux: "ITE",
      code: "ITE_DEMO",
      libelle: "Argumentaire ITE (configuration DEV/TEST)",
      pourquoi: "Le logement de type {{logement.typeBatiment}} pourrait bénéficier d'une isolation thermique par l'extérieur.",
      benefices: "Réduction des déperditions thermiques par les murs, amélioration du confort été comme hiver.",
      aConfirmer: "Nombre de façades concernées, mitoyenneté, accès échafaudage, contraintes d'urbanisme.",
      prochaineEtape: "Visite technique pour mesurer les façades et vérifier les contraintes.",
    },
  });

  await prisma.ficheMetier.upsert({
    where: { organisationId_code: { organisationId, code: "PAC_AIR_EAU_DEMO" } },
    update: {
      conditionsActivation: [
        { questionCode: "CHAUFFAGE_ACTUEL", valeurAttendue: "FIOUL" },
        { questionCode: "BESOIN_PRINCIPAL", valeurAttendue: "CHANGER_CHAUFFAGE" },
      ],
      donneesNecessairesEligibilite: ["Logement.surfaceChauffeeM2", "Logement.chauffagePrincipal"],
    },
    create: {
      organisationId,
      typeTravaux: "PAC_AIR_EAU",
      code: "PAC_AIR_EAU_DEMO",
      libelle: "Pompe à chaleur air/eau (configuration DEV/TEST)",
      ordre: 10,
      // Le moteur pondère satisfied/total (jamais un OU logique entre
      // plusieurs valeurs de la MÊME question - deux conditions sur
      // CHAUFFAGE_ACTUEL=FIOUL et =GAZ plafonneraient à 50%). Ici, deux
      // conditions sur des questions DIFFÉRENTES : le besoin client
      // (section 8/9, categorieImpact COMMERCIAL, n'influence QUE ce score
      // de pertinence, jamais l'éligibilité réglementaire) fait
      // naturellement monter la pertinence de FAIBLE/A_ETUDIER vers FORTE
      // au fil de l'appel, sans aucune logique supplémentaire dans le
      // moteur.
      conditionsActivation: [
        { questionCode: "CHAUFFAGE_ACTUEL", valeurAttendue: "FIOUL" },
        { questionCode: "BESOIN_PRINCIPAL", valeurAttendue: "CHANGER_CHAUFFAGE" },
      ],
      donneesNecessairesEligibilite: ["Logement.surfaceChauffeeM2", "Logement.chauffagePrincipal"],
      argumentaireId: argPac.id,
      typeRdvRecommande: "VISITE",
      prochaineAction: "VISITE_TECHNIQUE",
    },
  });

  await prisma.ficheMetier.upsert({
    where: { organisationId_code: { organisationId, code: "ITE_DEMO" } },
    update: {},
    create: {
      organisationId,
      typeTravaux: "ITE",
      code: "ITE_DEMO",
      libelle: "Isolation thermique par l'extérieur (configuration DEV/TEST)",
      ordre: 20,
      conditionsActivation: [{ questionCode: "TYPE_BATIMENT", valeurAttendue: "MAISON" }],
      donneesNecessairesEligibilite: ["Logement.isolationMurs", "Logement.typeBatiment"],
      argumentaireId: argIte.id,
      typeRdvRecommande: "VISITE",
      prochaineAction: "VISITE_TECHNIQUE",
    },
  });

  console.log(`FicheMetier PAC_AIR_EAU_DEMO et ITE_DEMO provisionnées pour l'organisation ${org.nom} (${organisationId}).`);
  console.log("Argumentaires : PAC_AIR_EAU_DEMO, ITE_DEMO (texte générique, aucune donnée réglementaire officielle).");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
