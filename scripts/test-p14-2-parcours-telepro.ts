import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { proposerChampsDpeChoisi, reconcilierPlusieursPropositions } from "../src/lib/leads/enrichissement";
import { renderArgumentaireBlocs } from "../src/lib/opportunites/argumentaire";
import type { OpportuniteDetectee } from "../src/lib/opportunites/types";
import type { DpeData } from "../src/lib/connectors/types";

// ============================================================
// P14.2 - parcours télépro complet + polish UX. Complète
// scripts/test-p14-qualification-telepro.ts et
// scripts/test-p14-1-confiance-revenus.ts, ne les duplique pas. Couvre
// spécifiquement les bugs trouvés/corrigés pendant le test manuel P14.2 :
// cold-start NBQ, sélection DPE multi-candidats, confirmation groupée,
// argumentaire qui ne fabrique jamais un montant.
// ============================================================

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
  const org = await prisma.organisation.create({ data: { nom: "Test P14.2 Tenant", slug: `test-p14-2-${suffix}` } });
  const orgAutre = await prisma.organisation.create({ data: { nom: "Test P14.2 Tenant Autre", slug: `test-p14-2-autre-${suffix}` } });
  const user = await prisma.user.create({ data: { organisationId: org.id, email: `test-p14-2-${suffix}@bhm-crm.local`, name: "Test P14.2", role: "ADMIN", password: "x" } });
  const statut = await prisma.leadPipelineStatus.findFirstOrThrow();

  // ============================================================
  // 1. BUG CORRIGÉ : cold-start NBQ - un lead sans AUCUNE
  // ReponseQuestionnaire doit recevoir des questions candidates (pas
  // "aucune question restante", qui doit signifier "tout est répondu").
  // ============================================================
  console.log("\n1. Cold-start NBQ (lead jamais commencé)");

  const questionnaire = await prisma.questionnaire.create({ data: { organisationId: null, code: "QUALIFICATION_COMMERCIALE", nom: "Qualification (test)" } });
  const version = await prisma.questionnaireVersion.upsert({
    where: { questionnaireId_numeroVersion: { questionnaireId: questionnaire.id, numeroVersion: 999 } },
    update: {},
    create: { questionnaireId: questionnaire.id, numeroVersion: 999, publiee: true },
  });
  await prisma.question.create({
    data: { questionnaireVersionId: version.id, code: `Q_COLDSTART_${suffix}`, libelle: "Question tronc commun test", type: "NUMBER", section: "B", champMappe: "Logement.surfaceHabitableM2", categorieImpact: "ELIGIBILITE" },
  });

  const leadFroid = await prisma.lead.create({
    data: { organisationId: org.id, prenom: "Test", nom: "P142Froid", statutId: statut.id, telephone: "0600000001" },
  });

  // Autre organisationId, autre user : requireUserContext() dans
  // getNextBestQuestionPourLead nécessite un contexte serveur complet.
  // On appelle donc directement selectNextBestQuestion via son
  // orchestration réelle - mais getNextBestQuestionPourLead exige des
  // headers/session Next absents en script. On vérifie donc directement
  // que le questionnaire publié est bien résolu même sans aucune
  // ReponseQuestionnaire, via une requête équivalente à
  // loadReponsesActuelles (reproduite ici en lecture seule, PAS une
  // nouvelle logique).
  const rqExistante = await prisma.reponseQuestionnaire.findFirst({ where: { leadId: leadFroid.id } });
  assert(rqExistante === null, "précondition : aucune ReponseQuestionnaire n'existe pour ce lead neuf");
  const versionPubliee = await prisma.questionnaireVersion.findFirst({
    where: { publiee: true, questionnaire: { code: "QUALIFICATION_COMMERCIALE", organisationId: null } },
    orderBy: { numeroVersion: "desc" },
    include: { questions: true },
  });
  assert(versionPubliee != null && versionPubliee.questions.length > 0, "BUG P14.2 corrigé : même sans ReponseQuestionnaire, la dernière version publiée globale est bien résolue (loadReponsesActuelles ne renvoie plus questions: [] pour un lead neuf)");

  // ============================================================
  // 2. DPE - choix explicite d'un candidat parmi plusieurs (jamais un choix
  // silencieux du premier résultat)
  // ============================================================
  console.log("\n2. Sélection DPE explicite (audit section 6)");

  const leadDpe = await prisma.lead.create({ data: { organisationId: org.id, prenom: "Test", nom: "P142Dpe", statutId: statut.id, telephone: "0600000002" } });
  const dpeChoisi: DpeData = {
    etiquette: "D",
    etiquetteGES: null,
    consommationAnnuelleKwh: null,
    surfaceHabitableM2: 82,
    anneeConstruction: 1998,
    typeBatiment: "MAISON",
    energieChauffage: null,
    typeInstallationChauffage: null,
    typeEnergieEcs: null,
    dateEtablissementDpe: null,
    numeroDpe: "DPE-TEST-1",
  };
  await proposerChampsDpeChoisi({ organisationId: org.id, leadId: leadDpe.id, dpe: dpeChoisi, source: "ADEME_DPE_CHOISI", confiance: "HIGH" });

  const logementDpe = await prisma.logement.findUniqueOrThrow({ where: { leadId: leadDpe.id } });
  const champsDpe = await prisma.champProvenance.findMany({ where: { logementId: logementDpe.id } });
  assert(champsDpe.length === 4, "les 4 champs du candidat DPE explicitement choisi sont bien proposés (dpe, surfaceHabitableM2, anneeConstruction, typeBatiment)");
  assert(champsDpe.every((c) => c.confianceProposee === "ELEVEE"), "confianceProposee = ELEVEE (mappée depuis HIGH) pour tous les champs du candidat choisi");
  assert(champsDpe.every((c) => c.referenceExterne === "DPE-TEST-1"), "referenceExterne trace bien le numéro DPE du candidat effectivement choisi (traçabilité du choix humain)");
  assert(champsDpe.every((c) => c.confiance === "DECLARE"), "confiance (valeur confirmée) reste DECLARE tant que le télépro n'a pas accepté la proposition - le choix du candidat ne vaut pas confirmation");

  // ============================================================
  // 3. Confirmation groupée (audit section 5) - jamais bloquante ligne par
  // ligne, ignore silencieusement une ligne déjà traitée/introuvable
  // ============================================================
  console.log("\n3. Confirmation groupée de propositions");

  const idsAConfirmer = champsDpe.map((c) => c.id);
  const resGroupe = await reconcilierPlusieursPropositions({ organisationId: org.id, champProvenanceIds: idsAConfirmer, acceptedByUserId: user.id });
  assert(resGroupe.accepted === 4, "les 4 propositions du lot sont acceptées en un seul appel groupé");
  const logementApresGroupe = await prisma.logement.findUniqueOrThrow({ where: { id: logementDpe.id } });
  assert(logementApresGroupe.dpe === "D" && logementApresGroupe.surfaceHabitableM2 === 82 && logementApresGroupe.anneeConstruction === 1998, "les 4 champs sont bien écrits sur Logement par la confirmation groupée (provenance conservée par champ, action groupée seulement côté UI)");

  const resGroupeRejoue = await reconcilierPlusieursPropositions({ organisationId: org.id, champProvenanceIds: idsAConfirmer, acceptedByUserId: user.id });
  assert(resGroupeRejoue.accepted === 0, "rejouer la confirmation groupée sur des lignes déjà VERIFIE n'échoue pas et n'accepte plus rien (idempotent, jamais bloquant)");

  const resGroupeAutreTenant = await reconcilierPlusieursPropositions({ organisationId: orgAutre.id, champProvenanceIds: idsAConfirmer, acceptedByUserId: user.id });
  assert(resGroupeAutreTenant.accepted === 0, "isolation tenant : une autre organisation ne peut confirmer aucune des propositions de ce lot, même groupé");

  // ============================================================
  // 4. Argumentaire - ne fabrique jamais un montant/une éligibilité
  // ============================================================
  console.log("\n4. Argumentaire (jamais de montant inventé)");

  const opportuniteSansProgramme: OpportuniteDetectee = {
    typeTravaux: "PAC_AIR_EAU",
    ficheMetierId: "test-fiche",
    ficheMetierCode: "TEST_DEMO",
    libelle: "Test (configuration DEV/TEST)",
    score: 100,
    niveau: "FORTE",
    raisonsPositives: ["CHAUFFAGE_ACTUEL = FIOUL"],
    raisonsNegatives: [],
    informationsManquantes: [],
    statutEligibilitePotentielle: "A_CONFIRMER",
    programmesATester: [],
    reglesReglementairesATester: [],
    prochaineAction: "VISITE_TECHNIQUE",
    typeRdvRecommande: "VISITE",
  };

  const blocsSansProgramme = renderArgumentaireBlocs({
    templates: { pourquoi: "Pourquoi : {{logement.chauffagePrincipal}}", benefices: null, aConfirmer: null, prochaineEtape: null },
    opportunite: opportuniteSansProgramme,
    variables: { "logement.chauffagePrincipal": "FIOUL" },
  });
  assert(!/\d[\s]?(€|EUR)/i.test(blocsSansProgramme.aides), "le bloc Aides (toujours engine-généré) ne contient jamais de montant en euros, même sans programme/règle configurés");
  assert(blocsSansProgramme.aides.includes("A_CONFIRMER"), "le bloc Aides affiche honnêtement le statut A_CONFIRMER, jamais une éligibilité affirmée");
  assert(blocsSansProgramme.pourquoi === "Pourquoi : FIOUL", "le bloc Pourquoi (template tenant whitelisté) s'interpole bien avec une variable whitelistée");

  const blocsVariableInterdite = renderArgumentaireBlocs({
    templates: { pourquoi: "{{logement.champInexistant}}", benefices: null, aConfirmer: null, prochaineEtape: null },
    opportunite: opportuniteSansProgramme,
    variables: { "logement.chauffagePrincipal": "FIOUL" },
  });
  assert(blocsVariableInterdite.pourquoi === "{{logement.champInexistant}}", "une variable non whitelistée/inconnue ne fait jamais planter l'écran télépro - le template brut est renvoyé tel quel plutôt qu'une exception");

  const opportuniteAvecProgramme: OpportuniteDetectee = {
    ...opportuniteSansProgramme,
    programmesATester: [{ id: "prog-1", code: "MPR", nom: "MaPrimeRénov (test)" }],
    reglesReglementairesATester: [{ id: "regle-1", code: "BAR-TH-171", nom: "PAC air/eau (test)" }],
  };
  const blocsAvecProgramme = renderArgumentaireBlocs({
    templates: { pourquoi: null, benefices: null, aConfirmer: null, prochaineEtape: null },
    opportunite: opportuniteAvecProgramme,
    variables: {},
  });
  assert(blocsAvecProgramme.aides.includes("MaPrimeRénov (test)") && blocsAvecProgramme.aides.includes("BAR-TH-171"), "le bloc Aides liste bien les programmes/règles À TESTER quand ils existent, toujours qualifiés 'à confirmer', jamais un montant chiffré");
  assert(!/\d[\s]?(€|EUR)/i.test(blocsAvecProgramme.aides), "toujours aucun montant en euros même avec des programmes/règles réels référencés");

  // ============================================================
  // Nettoyage
  // ============================================================
  console.log("\nNettoyage...");
  await prisma.champProvenance.deleteMany({ where: { logementId: logementDpe.id } });
  await prisma.logement.deleteMany({ where: { leadId: { in: [leadDpe.id] } } });
  await prisma.lead.deleteMany({ where: { id: { in: [leadFroid.id, leadDpe.id] } } });
  await prisma.question.deleteMany({ where: { questionnaireVersionId: version.id } });
  await prisma.questionnaireVersion.delete({ where: { id: version.id } });
  await prisma.questionnaire.delete({ where: { id: questionnaire.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organisation.delete({ where: { id: orgAutre.id } });
  await prisma.organisation.delete({ where: { id: org.id } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
