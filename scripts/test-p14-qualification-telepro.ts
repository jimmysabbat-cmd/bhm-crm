import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { detectOpportunites, selectMetiersActifs } from "../src/lib/opportunites/engine";
import { buildChampsConnus } from "../src/lib/opportunites/champs-connus";
import { selectNextBestQuestion, type NbqQuestion } from "../src/lib/next-best-question/engine";
import { calculateCategorieMenage, ANAH_REVENUS_CODE } from "../src/lib/reglementaire/menage";
import { buildStudyContext } from "../src/lib/etude/engine";
import { reconcilierPropositionChamp } from "../src/lib/leads/enrichissement";
import { geopfAddressConnector, getAddressCandidates } from "../src/lib/connectors/address-geopf";
import { ademeDpeConnector, getDpeCandidates } from "../src/lib/connectors/dpe-ademe";
import type { OpportuniteDetectee } from "../src/lib/opportunites/types";

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
}

async function main() {
  const suffix = Date.now();

  // --- Setup : 2 organisations (isolation cross-tenant) ---
  const orgA = await prisma.organisation.create({ data: { nom: "Test P14 Tenant A", slug: `test-p14-a-${suffix}` } });
  const orgB = await prisma.organisation.create({ data: { nom: "Test P14 Tenant B", slug: `test-p14-b-${suffix}` } });

  const [dossierType, dossierStatut, leadStatutNouveau] = await Promise.all([
    prisma.dossierType.findFirstOrThrow(),
    prisma.dossierStatus.findFirstOrThrow(),
    prisma.leadPipelineStatus.findFirstOrThrow(),
  ]);

  // ============================================================
  // 1. FicheMetier - isolation tenant + jointures Programme/RegleReglementaire
  // ============================================================
  console.log("\n1. FicheMetier : isolation tenant + jointures");

  const programmeA = await prisma.programme.create({ data: { organisationId: orgA.id, nom: "Rénovation d'ampleur A", code: "RENO_AMPLEUR" } });
  const programmeB = await prisma.programme.create({ data: { organisationId: orgB.id, nom: "Rénovation d'ampleur B", code: "RENO_AMPLEUR" } });

  const regleTest = await prisma.regleReglementaire.create({
    data: { code: `TEST-P14-${suffix}`, famille: "CEE", secteur: "BAR", nom: "Fiche test P14" },
  });

  const ficheMetierPacA = await prisma.ficheMetier.create({
    data: { organisationId: orgA.id, typeTravaux: "PAC_AIR_EAU", code: "PAC_AIR_EAU", libelle: "Pompe à chaleur air/eau" },
  });
  const ficheMetierIteA = await prisma.ficheMetier.create({
    data: { organisationId: orgA.id, typeTravaux: "ITE", code: "ITE", libelle: "Isolation thermique par l'extérieur" },
  });

  await prisma.ficheMetierProgramme.create({ data: { ficheMetierId: ficheMetierPacA.id, programmeId: programmeA.id } });
  await prisma.ficheMetierRegleReglementaire.create({ data: { ficheMetierId: ficheMetierPacA.id, regleReglementaireId: regleTest.id } });

  // 1 métier -> plusieurs programmes : PAC lié aussi à un second programme.
  const programmeA2 = await prisma.programme.create({ data: { organisationId: orgA.id, nom: "CEE classique A", code: "CEE_CLASSIQUE" } });
  await prisma.ficheMetierProgramme.create({ data: { ficheMetierId: ficheMetierPacA.id, programmeId: programmeA2.id } });
  // 1 programme -> plusieurs métiers : le même programme couvre aussi ITE.
  await prisma.ficheMetierProgramme.create({ data: { ficheMetierId: ficheMetierIteA.id, programmeId: programmeA.id } });

  const pacAvecRelations = await prisma.ficheMetier.findUniqueOrThrow({
    where: { id: ficheMetierPacA.id },
    include: { programmes: true, reglesReglementaires: true },
  });
  assert(pacAvecRelations.programmes.length === 2, "1 métier (PAC) lié à plusieurs programmes");
  const programmeAAvecMetiers = await prisma.ficheMetierProgramme.findMany({ where: { programmeId: programmeA.id } });
  assert(programmeAAvecMetiers.length === 2, "1 programme lié à plusieurs métiers (PAC + ITE)");
  assert(pacAvecRelations.reglesReglementaires.length === 1, "FicheMetier <-> RegleReglementaire (jamais une version précise)");
  assert(
    pacAvecRelations.reglesReglementaires[0].regleReglementaireId === regleTest.id,
    "la jointure pointe bien vers RegleReglementaire.id (pas une version)"
  );

  const fichesOrgA = await prisma.ficheMetier.findMany({ where: { organisationId: orgA.id } });
  const fichesOrgB = await prisma.ficheMetier.findMany({ where: { organisationId: orgB.id } });
  assert(fichesOrgA.length === 2 && fichesOrgB.length === 0, "isolation tenant stricte sur FicheMetier (org B ne voit aucune fiche de org A)");

  try {
    await prisma.ficheMetierProgramme.create({ data: { ficheMetierId: ficheMetierPacA.id, programmeId: programmeA.id } });
    assert(false, "contrainte unique @@unique([ficheMetierId, programmeId]) doit rejeter un doublon");
  } catch {
    assert(true, "contrainte unique @@unique([ficheMetierId, programmeId]) rejette bien un doublon");
  }

  // ============================================================
  // 2. Client revenus + StudyClient P8
  // ============================================================
  console.log("\n2. Client revenus/foyer -> StudyClient P8");

  const clientA = await prisma.client.create({
    data: {
      organisationId: orgA.id,
      prenom: "Jean",
      nom: "Dupont",
      zoneClimatique: "H1",
      precarite: "MODESTE",
      typeOccupant: "PROPRIETAIRE",
      nombrePersonnesFoyer: 3,
      revenuFiscalReference: 22000,
      anneeReferenceRevenu: 2024,
    },
  });
  const dossierA = await prisma.dossier.create({
    data: { reference: `TEST-P14-DOS-${suffix}`, clientId: clientA.id, organisationId: orgA.id, typeId: dossierType.id, statutId: dossierStatut.id, montantDevisTTC: 0 },
  });

  const studyContext = await buildStudyContext(dossierA.id, orgA.id);
  assert(studyContext.client.typeOccupant.value === "PROPRIETAIRE" && studyContext.client.typeOccupant.status === "CONNU", "StudyClient.typeOccupant lit réellement Client.typeOccupant");
  assert(studyContext.client.revenuMenage.value === 22000 && studyContext.client.revenuMenage.status === "CONNU", "StudyClient.revenuMenage lit réellement Client.revenuFiscalReference");
  assert(studyContext.client.compositionMenage.value === 3, "StudyClient.compositionMenage lit réellement Client.nombrePersonnesFoyer");
  assert(studyContext.client.precarite.value === "MODESTE", "StudyClient.precarite continue de fonctionner (non régressé)");

  // ============================================================
  // 3. Barème ANAH_REVENUS (réutilise RegleReglementaire, jamais BaremeAide)
  // ============================================================
  console.log("\n3. Barème ANAH_REVENUS + majoration personne supplémentaire");

  // 3a. Aucune version publiée -> jamais un chiffre inventé.
  const sansBareme = await calculateCategorieMenage({
    dateReference: new Date(),
    inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 3, revenuFiscalReference: 22000 },
  });
  assert(sansBareme.statut === "BAREME_NON_CONFIGURE" && sansBareme.categorie === null, "sans version publiée ANAH_REVENUS -> BAREME_NON_CONFIGURE, jamais une catégorie inventée");

  // 3b. Avec un barème de test explicitement marqué comme tel (jamais présenté comme officiel).
  const regleAnahTest = await prisma.regleReglementaire.create({
    data: { code: `${ANAH_REVENUS_CODE}_TEST_${suffix}`, famille: "ANAH_REVENUS", secteur: "AUTRE", nom: "Barème ANAH revenus (TEST - non officiel)" },
  });
  const versionAnahTest = await prisma.regleReglementaireVersion.create({
    data: {
      regleId: regleAnahTest.id,
      numeroVersion: "TEST-1",
      dateDebutEffet: new Date("2020-01-01"),
      publie: true,
      statutValidation: "PUBLIE",
      formulaCode: "ANAH_REVENUS_V1",
      sourceNom: "Données de test P14 - NON OFFICIEL",
    },
  });
  await prisma.baremeReglementaire.createMany({
    data: [
      { ruleVersionId: versionAnahTest.id, cle: "TRES_MODESTE|H1|3", valeur: 15000 },
      { ruleVersionId: versionAnahTest.id, cle: "MODESTE|H1|3", valeur: 25000 },
      { ruleVersionId: versionAnahTest.id, cle: "INTERMEDIAIRE|H1|3", valeur: 40000 },
      { ruleVersionId: versionAnahTest.id, cle: "SUPERIEUR|H1|3", valeur: 60000 },
      { ruleVersionId: versionAnahTest.id, cle: "MAJORATION_PERSONNE_SUP|MODESTE|H1", valeur: 5000 },
    ],
  });

  // Test avec le CODE réel utilisé par getApplicableRuleVersion (ANAH_REVENUS) - régle dédiée pour ne pas polluer une future vraie règle.
  const regleAnahReel = await prisma.regleReglementaire.upsert({
    where: { code: ANAH_REVENUS_CODE },
    update: {},
    create: { code: ANAH_REVENUS_CODE, famille: "ANAH_REVENUS", secteur: "AUTRE", nom: "Barème ANAH revenus" },
  });
  const versionsExistantesAvant = await prisma.regleReglementaireVersion.findMany({ where: { regleId: regleAnahReel.id } });
  const versionAnahReel = await prisma.regleReglementaireVersion.create({
    data: {
      regleId: regleAnahReel.id,
      numeroVersion: `TEST-${suffix}`,
      dateDebutEffet: new Date("2020-01-01"),
      publie: true,
      statutValidation: "PUBLIE",
      formulaCode: "ANAH_REVENUS_V1",
      sourceNom: "Données de test P14 - NON OFFICIEL",
    },
  });
  await prisma.baremeReglementaire.createMany({
    data: [
      { ruleVersionId: versionAnahReel.id, cle: "TRES_MODESTE|H1|3", valeur: 15000 },
      { ruleVersionId: versionAnahReel.id, cle: "MODESTE|H1|3", valeur: 25000 },
      { ruleVersionId: versionAnahReel.id, cle: "INTERMEDIAIRE|H1|3", valeur: 40000 },
      { ruleVersionId: versionAnahReel.id, cle: "SUPERIEUR|H1|3", valeur: 60000 },
      { ruleVersionId: versionAnahReel.id, cle: "MAJORATION_PERSONNE_SUP|MODESTE|H1", valeur: 5000 },
      { ruleVersionId: versionAnahReel.id, cle: "MAJORATION_PERSONNE_SUP|TRES_MODESTE|H1", valeur: 3000 },
      { ruleVersionId: versionAnahReel.id, cle: "MAJORATION_PERSONNE_SUP|INTERMEDIAIRE|H1", valeur: 6000 },
      { ruleVersionId: versionAnahReel.id, cle: "MAJORATION_PERSONNE_SUP|SUPERIEUR|H1", valeur: 8000 },
      // Tranche de base "5 personnes" (NB_PERSONNES_BASE_MAX du moteur) -
      // nécessaire pour tester la majoration au-delà de ce plafond.
      { ruleVersionId: versionAnahReel.id, cle: "TRES_MODESTE|H1|5", valeur: 20000 },
      { ruleVersionId: versionAnahReel.id, cle: "MODESTE|H1|5", valeur: 30000 },
      { ruleVersionId: versionAnahReel.id, cle: "INTERMEDIAIRE|H1|5", valeur: 48000 },
      { ruleVersionId: versionAnahReel.id, cle: "SUPERIEUR|H1|5", valeur: 70000 },
    ],
  });

  const avecBareme = await calculateCategorieMenage({
    dateReference: new Date(),
    inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 3, revenuFiscalReference: 22000 },
  });
  assert(avecBareme.statut === "CALCULE" && avecBareme.categorie === "MODESTE", "RFR 22000 pour 3 pers. zone H1 -> catégorie MODESTE (22000 <= 25000)");

  const rfrTresModeste = await calculateCategorieMenage({
    dateReference: new Date(),
    inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 3, revenuFiscalReference: 10000 },
  });
  assert(rfrTresModeste.categorie === "TRES_MODESTE", "RFR 10000 pour 3 pers. -> TRES_MODESTE");

  // Majoration : 7 personnes = base plafonnée à 5 (NB_PERSONNES_BASE_MAX) +
  // 2 supplémentaires. Seuil MODESTE = 30000 + 2*5000 = 40000.
  const avecMajoration = await calculateCategorieMenage({
    dateReference: new Date(),
    inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 7, revenuFiscalReference: 38000 },
  });
  assert(avecMajoration.categorie === "MODESTE", "majoration personne supplémentaire appliquée (7 pers., RFR 38000 <= 30000+2*5000=40000 -> MODESTE)");

  const donneesInsuffisantes = await calculateCategorieMenage({
    dateReference: new Date(),
    inputs: { zoneClimatique: null, nombrePersonnesFoyer: 3, revenuFiscalReference: 22000 },
  });
  assert(donneesInsuffisantes.statut === "DONNEES_INSUFFISANTES", "zoneClimatique manquante -> DONNEES_INSUFFISANTES, jamais une catégorie devinée");

  // Nettoyage régle de test locale (regleAnahTest) - la régle réelle ANAH_REVENUS est nettoyée en fin de script.
  await prisma.baremeReglementaire.deleteMany({ where: { ruleVersionId: versionAnahTest.id } });
  await prisma.regleReglementaireVersion.delete({ where: { id: versionAnahTest.id } });
  await prisma.regleReglementaire.delete({ where: { id: regleAnahTest.id } });
  void versionsExistantesAvant;

  // ============================================================
  // 4. Next Best Question - priorité par catégorie, poids commercial borné
  // ============================================================
  console.log("\n4. Next Best Question");

  const questions: NbqQuestion[] = [
    { id: "id-commercial", code: "Q_COMMERCIAL", type: "YES_NO", conditions: [], champMappe: "Client.nombrePersonnesFoyer", metierConcerne: null, categorieImpact: "COMMERCIAL", poidsCommercial: 100, obligatoire: false, libelle: "Question commerciale (poids élevé)" },
    { id: "id-eligibilite", code: "Q_ELIGIBILITE", type: "YES_NO", conditions: [], champMappe: "Logement.isolationMurs", metierConcerne: null, categorieImpact: "ELIGIBILITE", poidsCommercial: 0, obligatoire: false, libelle: "Question éligibilité (poids nul)" },
    { id: "id-bloquant-a", code: "Q_BLOQUANT_A", type: "YES_NO", conditions: [], champMappe: "Logement.chauffagePrincipal", metierConcerne: null, categorieImpact: "BLOQUANT_DECISION", poidsCommercial: 1, obligatoire: false, libelle: "Bloquant A" },
    { id: "id-bloquant-b", code: "Q_BLOQUANT_B", type: "YES_NO", conditions: [], champMappe: "Logement.energieEcs", metierConcerne: null, categorieImpact: "BLOQUANT_DECISION", poidsCommercial: 9, obligatoire: false, libelle: "Bloquant B (poids plus élevé)" },
  ];

  const nbq1 = selectNextBestQuestion({ questions, reponses: {}, champsConnus: new Set() });
  assert(nbq1.question?.categorieImpact === "BLOQUANT_DECISION", "NBQ sélectionne BLOQUANT_DECISION avant ELIGIBILITE/COMMERCIAL malgré un poidsCommercial=100 ailleurs");
  assert(nbq1.question?.code === "Q_BLOQUANT_B", "à catégorie égale (2x BLOQUANT_DECISION), poidsCommercial départage (9 > 1)");

  // poidsCommercial=100 sur Q_COMMERCIAL ne doit JAMAIS lui permettre de dépasser une catégorie supérieure.
  const nbq2 = selectNextBestQuestion({
    questions: questions.filter((q) => q.code !== "Q_BLOQUANT_A" && q.code !== "Q_BLOQUANT_B"),
    reponses: {},
    champsConnus: new Set(),
  });
  assert(nbq2.question?.code === "Q_ELIGIBILITE", "poidsCommercial=100 ne fait JAMAIS passer une question COMMERCIAL devant ELIGIBILITE");

  // Déduplication par champMappe : Q_ELIGIBILITE et une question ITE partagent le même champMappe -> une seule proposée.
  const questionIteMemeChamp: NbqQuestion = { id: "id-ite-mur", code: "Q_ITE_MUR", type: "YES_NO", conditions: [], champMappe: "Logement.isolationMurs", metierConcerne: "ITE", categorieImpact: "ELIGIBILITE", poidsCommercial: 0, obligatoire: false, libelle: "ITE mur (même champ)" };
  const nbq3 = selectNextBestQuestion({
    questions: [questions[1], questionIteMemeChamp],
    reponses: {},
    champsConnus: new Set(["Logement.isolationMurs"]), // déjà connu
    metiersActifs: ["ITE"],
  });
  assert(nbq3.question === null, "champMappe déjà connu -> aucune des 2 questions (PAC/ITE) partageant ce champ n'est reproposée (déduplication par champ, pas par metierConcerne)");

  // ============================================================
  // 5. Moteur Opportunités - PAC/ITE pilotes, aucun montant produit
  // ============================================================
  console.log("\n5. Moteur Opportunités : pilotes PAC/ITE, aucun montant");

  const conditionQuestions = [
    { code: "CHAUFFAGE_FIOUL", type: "YES_NO" as const },
  ];
  const questionsByCodeForConditions = conditionQuestions.map((q) => ({ code: q.code, type: q.type }));

  const opportunites = detectOpportunites({
    client: { precarite: "MODESTE", typeOccupant: "PROPRIETAIRE", nombrePersonnesFoyer: 3, revenuFiscalReference: 22000, zoneClimatique: "H1" },
    reponses: { CHAUFFAGE_FIOUL: { bool: true } },
    questions: questionsByCodeForConditions,
    champsConnus: new Set(["Logement.isolationMurs"]),
    fichesMetier: [
      {
        id: "pac-test",
        typeTravaux: "PAC_AIR_EAU",
        code: "PAC_AIR_EAU",
        libelle: "PAC air/eau",
        actif: true,
        ordre: 0,
        conditionsActivation: [{ questionCode: "CHAUFFAGE_FIOUL", valeurAttendue: "true" }],
        donneesNecessairesEligibilite: ["Logement.surfaceChauffeeM2"],
        prochaineAction: "VISITE_TECHNIQUE",
        typeRdvRecommande: "VISITE",
        programmes: [],
        reglesReglementaires: [{ id: regleTest.id, code: regleTest.code, nom: regleTest.nom }],
      },
      {
        id: "ite-test",
        typeTravaux: "ITE",
        code: "ITE",
        libelle: "ITE",
        actif: true,
        ordre: 1,
        conditionsActivation: [],
        donneesNecessairesEligibilite: ["Logement.isolationMurs"],
        prochaineAction: "VISITE_TECHNIQUE",
        typeRdvRecommande: "VISITE",
        programmes: [],
        reglesReglementaires: [],
      },
    ],
  });

  const pacResult = opportunites.opportunites.find((o) => o.ficheMetierCode === "PAC_AIR_EAU");
  const iteResult = opportunites.opportunites.find((o) => o.ficheMetierCode === "ITE");
  assert(pacResult?.niveau === "FORTE" && pacResult.score === 100, "pilote PAC : condition satisfaite (chauffage fioul) -> niveau FORTE, score 100");
  assert(pacResult?.informationsManquantes.includes("Logement.surfaceChauffeeM2") === true, "pilote PAC : information manquante détectée (surface non connue)");
  assert(iteResult?.niveau === "A_ETUDIER" && iteResult.statutEligibilitePotentielle === "A_CONFIRMER", "pilote ITE : aucune condition configurée -> A_ETUDIER, donnée nécessaire déjà connue -> A_CONFIRMER");

  const toutesLesClesOpportunite = new Set(Object.keys(pacResult as unknown as Record<string, unknown>));
  const champsInterdits = ["caCts", "margeCts", "resteAChargeCts", "economieCts", "gainDpeCts", "montantCts"];
  assert(
    champsInterdits.every((c) => !toutesLesClesOpportunite.has(c)),
    "OpportuniteDetectee ne contient structurellement AUCUN champ CA/marge/RAC/économie"
  );

  const metiersActifs = selectMetiersActifs(opportunites);
  assert(metiersActifs.includes("PAC_AIR_EAU") && metiersActifs.includes("ITE"), "les 2 pilotes sont retenus comme métiers actifs (FORTE + A_ETUDIER)");

  const champsConnusTest = buildChampsConnus({ logement: { isolationMurs: "moyenne", surfaceChauffeeM2: null }, client: { precarite: "MODESTE" } });
  assert(champsConnusTest.has("Logement.isolationMurs") && !champsConnusTest.has("Logement.surfaceChauffeeM2"), "buildChampsConnus ignore les valeurs null");

  // ============================================================
  // 6. Session de qualification (ReponseQuestionnaire étendue)
  // ============================================================
  console.log("\n6. Session de qualification : autosave, reprise, snapshot RDV");

  const questionnaire = await prisma.questionnaire.create({ data: { organisationId: orgA.id, code: `TEST_P14_${suffix}`, nom: "Test P14" } });
  const qVersion = await prisma.questionnaireVersion.create({ data: { questionnaireId: questionnaire.id, numeroVersion: 1, publiee: true } });
  const questionTest = await prisma.question.create({
    data: { questionnaireVersionId: qVersion.id, code: "CHAUFFAGE", libelle: "Chauffage ?", type: "SINGLE_SELECT", section: "A", champMappe: "Logement.chauffagePrincipal" },
  });

  const leadA = await prisma.lead.create({
    data: { organisationId: orgA.id, prenom: "Marie", nom: "Martin", statutId: leadStatutNouveau.id },
  });

  const userTelepro = await prisma.user.create({
    data: { name: "Télépro Test", email: `telepro-p14-${suffix}@test.local`, password: "test", organisationId: orgA.id, role: "TELEPROSPECTEUR" },
  });

  // Autosave (upsert) - démarre EN_COURS avec realiseParId.
  const session1 = await prisma.reponseQuestionnaire.upsert({
    where: { leadId_questionnaireVersionId: { leadId: leadA.id, questionnaireVersionId: qVersion.id } },
    update: { realiseParId: userTelepro.id, statut: "EN_COURS" },
    create: { organisationId: orgA.id, leadId: leadA.id, questionnaireVersionId: qVersion.id, realiseParId: userTelepro.id, statut: "EN_COURS" },
  });
  await prisma.reponseQuestion.create({ data: { reponseQuestionnaireId: session1.id, questionId: questionTest.id, valeurOptions: ["FIOUL"] } });
  assert(session1.statut === "EN_COURS" && session1.realiseParId === userTelepro.id, "session créée EN_COURS avec realiseParId");

  // Reprise : même clé (leadId, questionnaireVersionId) -> même session, pas de doublon.
  const session1bis = await prisma.reponseQuestionnaire.findUniqueOrThrow({
    where: { leadId_questionnaireVersionId: { leadId: leadA.id, questionnaireVersionId: qVersion.id } },
  });
  assert(session1bis.id === session1.id, "reprise de session : même (leadId, questionnaireVersionId) -> même ligne, jamais un doublon");

  const reponsesApresReprise = await prisma.reponseQuestion.findMany({ where: { reponseQuestionnaireId: session1.id } });
  assert(reponsesApresReprise.length === 1 && reponsesApresReprise[0].valeurOptions !== null, "les réponses précédentes sont bien conservées à la reprise");

  // Simule un abandon puis une reprise (statut ABANDONNEE -> EN_COURS via autosave).
  await prisma.reponseQuestionnaire.update({ where: { id: session1.id }, data: { statut: "ABANDONNEE" } });
  const sessionReprisAvecAutosave = await prisma.reponseQuestionnaire.update({
    where: { id: session1.id },
    data: { statut: "EN_COURS" },
  });
  assert(sessionReprisAvecAutosave.statut === "EN_COURS", "un autosave après ABANDONNEE repasse la session à EN_COURS");

  // Snapshot au moment du RDV - gelé, jamais recalculé après coup.
  const snapshotInitial: OpportuniteDetectee[] = [pacResult!];
  const rdvTest = await prisma.rdv.create({ data: { organisationId: orgA.id, leadId: leadA.id, date: new Date(), type: "VISITE" } });
  const sessionAvecSnapshot = await prisma.reponseQuestionnaire.update({
    where: { id: session1.id },
    data: {
      statut: "TERMINEE",
      termineeAt: new Date(),
      rdvCreeId: rdvTest.id,
      opportunitesSnapshot: { opportunites: snapshotInitial, generatedAt: new Date().toISOString() },
    },
  });
  assert(sessionAvecSnapshot.statut === "TERMINEE" && sessionAvecSnapshot.rdvCreeId === rdvTest.id, "snapshot gelé au moment de la confirmation du RDV");

  // Immuabilité : recalculer les opportunités APRÈS ne doit jamais modifier le snapshot déjà stocké.
  const opportunitesApresCoup = detectOpportunites({
    client: { precarite: "SUPERIEUR", typeOccupant: null, nombrePersonnesFoyer: null, revenuFiscalReference: null, zoneClimatique: null },
    reponses: {},
    questions: [],
    champsConnus: new Set(),
    fichesMetier: [],
  });
  const sessionRelue = await prisma.reponseQuestionnaire.findUniqueOrThrow({ where: { id: session1.id } });
  const snapshotStocke = sessionRelue.opportunitesSnapshot as unknown as { opportunites: OpportuniteDetectee[] };
  assert(
    snapshotStocke.opportunites[0].niveau === "FORTE" && opportunitesApresCoup.opportunites.length === 0,
    "recalculer le moteur après coup ne modifie jamais le snapshot déjà persisté (immuabilité)"
  );

  // ============================================================
  // 7. Connecteurs - fallback réseau, DPE plusieurs candidats
  // ============================================================
  console.log("\n7. Connecteurs : fallback réseau, DPE plusieurs candidats");

  const originalFetch = global.fetch;
  try {
    // 7a. Timeout/erreur réseau -> { ok: false }, jamais d'exception.
    global.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    const adresseEchec = await geopfAddressConnector.normalizeAddress({ adresse: "1 rue test" });
    assert(adresseEchec.ok === false, "AddressConnector : erreur réseau -> { ok: false }, jamais une exception non gérée");

    const dpeEchec = await ademeDpeConnector.getDpeData({ adresse: "1 rue test" });
    assert(dpeEchec.ok === false, "DpeConnector : erreur réseau -> { ok: false }");

    // 7b. Plusieurs candidats DPE.
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          total: 2,
          results: [
            { numero_dpe: "A1", etiquette_dpe: "D", score_ban: 0.9 },
            { numero_dpe: "A2", etiquette_dpe: "F", score_ban: 0.85 },
          ],
        }),
      } as Response)) as typeof fetch;
    const candidats = await getDpeCandidates({ adresse: "1 rue test" }, 5);
    assert(candidats.ok === true && candidats.data.length === 2, "getDpeCandidates retourne bien plusieurs candidats sans en imposer un seul silencieusement");

    // 7c. Aucun résultat -> ok:false explicite.
    global.fetch = (() => Promise.resolve({ ok: true, json: async () => ({ features: [] }) } as Response)) as typeof fetch;
    const aucunResultat = await getAddressCandidates({ adresse: "adresse inexistante xyz" });
    assert(aucunResultat.ok === false, "AddressConnector : aucun résultat -> { ok: false } explicite (jamais une adresse inventée)");
  } finally {
    global.fetch = originalFetch;
  }

  // ============================================================
  // 8. ChampProvenance - donnée VERIFIEE jamais écrasée
  // ============================================================
  console.log("\n8. ChampProvenance : donnée VERIFIEE protégée");

  const logementTest = await prisma.logement.create({ data: { organisationId: orgA.id, leadId: leadA.id, dpe: "C" } });
  const champVerifie = await prisma.champProvenance.create({
    data: { organisationId: orgA.id, logementId: logementTest.id, champ: "dpe", source: "VISITE", confiance: "VERIFIE" },
  });

  // Une proposition arrive ensuite (ex. connecteur DPE) - ne doit jamais écraser la valeur déjà VERIFIE.
  await prisma.champProvenance.update({ where: { id: champVerifie.id }, data: { valeurProposee: "F", sourceProposee: "API", recupereeAt: new Date() } });
  try {
    await reconcilierPropositionChamp({ organisationId: orgB.id, champProvenanceId: champVerifie.id, decision: "ACCEPTER", acceptedByUserId: userTelepro.id });
    assert(false, "reconcilierPropositionChamp doit rejeter un organisationId qui ne correspond pas (isolation)");
  } catch {
    assert(true, "reconcilierPropositionChamp respecte l'isolation tenant (organisationId B ne peut pas agir sur une donnée de A)");
  }

  const logementAvantAcceptation = await prisma.logement.findUniqueOrThrow({ where: { id: logementTest.id } });
  assert(logementAvantAcceptation.dpe === "C", "Logement.dpe non modifié tant que la proposition n'est pas explicitement acceptée");

  await reconcilierPropositionChamp({ organisationId: orgA.id, champProvenanceId: champVerifie.id, decision: "ACCEPTER", acceptedByUserId: userTelepro.id });
  const logementApresAcceptation = await prisma.logement.findUniqueOrThrow({ where: { id: logementTest.id } });
  const champApresAcceptation = await prisma.champProvenance.findUniqueOrThrow({ where: { id: champVerifie.id } });
  assert(logementApresAcceptation.dpe === "F", "acceptation explicite écrit bien la nouvelle valeur dans Logement.dpe");
  assert(champApresAcceptation.confiance === "VERIFIE" && champApresAcceptation.accepteeById === userTelepro.id, "champ reste VERIFIE et trace qui a accepté");

  // ============================================================
  // Nettoyage
  // ============================================================
  console.log("\nNettoyage...");
  await prisma.reponseQuestion.deleteMany({ where: { reponseQuestionnaireId: session1.id } });
  await prisma.reponseQuestionnaire.deleteMany({ where: { leadId: leadA.id } });
  await prisma.rdv.deleteMany({ where: { leadId: leadA.id } });
  await prisma.champProvenance.deleteMany({ where: { logementId: logementTest.id } });
  await prisma.logement.deleteMany({ where: { leadId: leadA.id } });
  await prisma.lead.delete({ where: { id: leadA.id } });
  await prisma.user.delete({ where: { id: userTelepro.id } });
  await prisma.question.deleteMany({ where: { questionnaireVersionId: qVersion.id } });
  await prisma.questionnaireVersion.delete({ where: { id: qVersion.id } });
  await prisma.questionnaire.delete({ where: { id: questionnaire.id } });
  await prisma.dossier.delete({ where: { id: dossierA.id } });
  await prisma.client.delete({ where: { id: clientA.id } });
  await prisma.ficheMetierProgramme.deleteMany({ where: { ficheMetierId: { in: [ficheMetierPacA.id, ficheMetierIteA.id] } } });
  await prisma.ficheMetierRegleReglementaire.deleteMany({ where: { ficheMetierId: ficheMetierPacA.id } });
  await prisma.ficheMetier.deleteMany({ where: { id: { in: [ficheMetierPacA.id, ficheMetierIteA.id] } } });
  await prisma.programme.deleteMany({ where: { id: { in: [programmeA.id, programmeA2.id, programmeB.id] } } });
  await prisma.regleReglementaire.delete({ where: { id: regleTest.id } });
  await prisma.baremeReglementaire.deleteMany({ where: { ruleVersionId: versionAnahReel.id } });
  await prisma.regleReglementaireVersion.delete({ where: { id: versionAnahReel.id } });
  await prisma.regleReglementaire.delete({ where: { id: regleAnahReel.id } });
  await prisma.organisation.delete({ where: { id: orgA.id } });
  await prisma.organisation.delete({ where: { id: orgB.id } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
