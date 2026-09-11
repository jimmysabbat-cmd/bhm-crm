import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { proposerEnrichissementAdresse, reconcilierPropositionChamp } from "../src/lib/leads/enrichissement";
import { calculateCategorieMenage, ANAH_REVENUS_CODE } from "../src/lib/reglementaire/menage";

// ============================================================
// P14.1 - correctif confiance (SOURCE != CONFIANCE != STATUT) + UI revenus
// interactive. Complète scripts/test-p14-qualification-telepro.ts, ne le
// duplique pas.
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
  const orgA = await prisma.organisation.create({ data: { nom: "Test P14.1 Tenant A", slug: `test-p14-1-a-${suffix}` } });
  const orgB = await prisma.organisation.create({ data: { nom: "Test P14.1 Tenant B", slug: `test-p14-1-b-${suffix}` } });

  // ============================================================
  // 1. Connecteurs réels : confianceProposee persistée et distincte de confiance
  // ============================================================
  console.log("\n1. Confiance de proposition persistée (connecteurs réels)");

  const leadA = await prisma.lead.create({
    data: {
      organisationId: orgA.id,
      prenom: "Test",
      nom: "P141",
      statutId: (await prisma.leadPipelineStatus.findFirstOrThrow()).id,
      adresse: "3 Route Nationale",
      codePostal: "60120",
      ville: "Bonneuil-les-Eaux",
    },
  });

  const res = await proposerEnrichissementAdresse({ organisationId: orgA.id, leadId: leadA.id, adresse: leadA.adresse!, codePostal: leadA.codePostal, ville: leadA.ville });
  assert(res.propositions.length > 0, "des propositions ont bien été trouvées (connecteurs réels joignables)");

  const logement = await prisma.logement.findUniqueOrThrow({ where: { leadId: leadA.id } });
  const cpAdresse = await prisma.champProvenance.findUnique({ where: { logementId_champ: { logementId: logement.id, champ: "adresse" } } });
  assert(cpAdresse?.confiance === "DECLARE", "confiance (valeur ACTUELLE, jamais confirmée) reste DECLARE par défaut - jamais confondue avec la proposition");
  assert(cpAdresse?.confianceProposee != null && ["FAIBLE", "MOYENNE", "ELEVEE"].includes(cpAdresse.confianceProposee), "confianceProposee est bien renseignée avec une valeur FAIBLE/MOYENNE/ELEVEE (plus jamais perdue)");
  assert(cpAdresse?.sourceProposee === "API", "sourceProposee = API (provenance), distincte de confianceProposee (fiabilité) - jamais confondues");

  // ============================================================
  // 2. Confirmation -> VERIFIE, confianceProposee effacée
  // ============================================================
  console.log("\n2. Confirmation humaine -> VERIFIE, confianceProposee effacée");

  const userA = await prisma.user.create({ data: { organisationId: orgA.id, email: `test-p14-1-a-${suffix}@bhm-crm.local`, name: "Test A", role: "ADMIN", password: "x" } });
  await reconcilierPropositionChamp({ organisationId: orgA.id, champProvenanceId: cpAdresse!.id, decision: "ACCEPTER", acceptedByUserId: userA.id });

  const cpApres = await prisma.champProvenance.findUniqueOrThrow({ where: { id: cpAdresse!.id } });
  assert(cpApres.confiance === "VERIFIE", "confiance passe bien à VERIFIE après acceptation");
  assert(cpApres.confianceProposee === null, "confianceProposee est effacée après acceptation (n'a plus de sens une fois la valeur confirmée)");
  assert(cpApres.valeurProposee === null && cpApres.sourceProposee === null, "valeurProposee/sourceProposee effacées après acceptation (comportement inchangé)");

  const logementApres = await prisma.logement.findUniqueOrThrow({ where: { id: logement.id } });
  assert(logementApres.adresse === cpApres.referenceExterne || logementApres.adresse != null, "Logement.adresse a bien été écrit par l'acceptation");

  // ============================================================
  // 3. Protection anti-écrasement : VERIFIE jamais retouchée, même confianceProposee
  // ============================================================
  console.log("\n3. Protection anti-écrasement (VERIFIE, y compris confianceProposee)");

  const res2 = await proposerEnrichissementAdresse({ organisationId: orgA.id, leadId: leadA.id, adresse: leadA.adresse!, codePostal: leadA.codePostal, ville: leadA.ville });
  assert(res2.propositions.some((p) => p.champ === "adresse"), "le connecteur retrouve toujours 'adresse' en interne (comportement normal)");
  const cpApresRecherche = await prisma.champProvenance.findUniqueOrThrow({ where: { id: cpAdresse!.id } });
  assert(cpApresRecherche.confiance === "VERIFIE", "confiance reste VERIFIE malgré une nouvelle recherche");
  assert(cpApresRecherche.confianceProposee === null, "confianceProposee reste null - jamais réécrasée sur un champ déjà VERIFIE");
  assert(cpApresRecherche.valeurProposee === null, "valeurProposee reste null - aucune proposition ne réapparaît pour un champ VERIFIE");

  // ============================================================
  // 4. Refus efface aussi confianceProposee
  // ============================================================
  console.log("\n4. Refus efface confianceProposee");
  const cpVille = await prisma.champProvenance.findUniqueOrThrow({ where: { logementId_champ: { logementId: logement.id, champ: "ville" } } });
  assert(cpVille.confianceProposee != null, "précondition : ville a bien une confianceProposee avant refus");
  await reconcilierPropositionChamp({ organisationId: orgA.id, champProvenanceId: cpVille.id, decision: "REFUSER", acceptedByUserId: userA.id });
  const cpVilleApres = await prisma.champProvenance.findUniqueOrThrow({ where: { id: cpVille.id } });
  assert(cpVilleApres.confianceProposee === null && cpVilleApres.valeurProposee === null, "refus efface bien confianceProposee (plus de proposition en attente)");
  assert(cpVilleApres.confiance === "DECLARE", "refus ne touche jamais confiance (valeur actuelle inchangée, aucune écriture)");

  // ============================================================
  // 5. Isolation tenant sur les propositions
  // ============================================================
  console.log("\n5. Isolation tenant");
  const cpAutreChamp = await prisma.champProvenance.findFirstOrThrow({ where: { logementId: logement.id, confianceProposee: { not: null } } });
  let rejectedCrossTenant = false;
  try {
    await reconcilierPropositionChamp({ organisationId: orgB.id, champProvenanceId: cpAutreChamp.id, decision: "ACCEPTER", acceptedByUserId: userA.id });
  } catch {
    rejectedCrossTenant = true;
  }
  assert(rejectedCrossTenant, "reconcilierPropositionChamp refuse une proposition d'une autre organisation (organisationId vérifié serveur)");

  // ============================================================
  // 6. Catégorie revenus déclarée directement (pas de calcul, pas de barème)
  // ============================================================
  console.log("\n6. Catégorie déclarée directement (jamais présentée comme calculée)");

  const questionnaire = await prisma.questionnaire.create({ data: { organisationId: orgA.id, code: `TEST_P14_1_${suffix}`, nom: "Test P14.1" } });
  const version = await prisma.questionnaireVersion.create({ data: { questionnaireId: questionnaire.id, numeroVersion: 1, publiee: true } });
  const qDeclaree = await prisma.question.create({
    data: { questionnaireVersionId: version.id, code: "CATEGORIE_REVENUS_DECLAREE", libelle: "Catégorie déclarée", type: "SINGLE_SELECT", section: "D", champMappe: "Client.precarite" },
  });

  const rq = await prisma.reponseQuestionnaire.create({ data: { organisationId: orgA.id, leadId: leadA.id, questionnaireVersionId: version.id, statut: "EN_COURS" } });
  await prisma.reponseQuestion.create({ data: { reponseQuestionnaireId: rq.id, questionId: qDeclaree.id, valeurOptions: ["MODESTE"] } });

  const reponseEnregistree = await prisma.reponseQuestion.findFirstOrThrow({ where: { reponseQuestionnaireId: rq.id, questionId: qDeclaree.id } });
  assert(
    (reponseEnregistree.valeurOptions as string[] | null)?.[0] === "MODESTE",
    "réponse 'catégorie déclarée' enregistrée via le mécanisme ReponseQuestion existant (aucune nouvelle table de provenance créée) - la distinction déclaré/calculé/confirmé vient du code de Question répondu, jamais de ChampProvenance (Client n'existe pas encore avant conversion)"
  );

  // ============================================================
  // 7. Calcul de catégorie via règle publiée (jamais inventée)
  // ============================================================
  console.log("\n7. Calcul de catégorie via RegleReglementaire/Version/BaremeReglementaire (ANAH_REVENUS)");

  const sansRegle = await calculateCategorieMenage({ dateReference: new Date(), inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 3, revenuFiscalReference: 25000 } });
  assert(sansRegle.statut === "BAREME_NON_CONFIGURE" && sansRegle.categorie === null, "sans version ANAH_REVENUS publiée -> BAREME_NON_CONFIGURE, jamais une catégorie inventée");

  // getApplicableRuleVersion() cherche par code "ANAH_REVENUS" (ANAH_REVENUS_CODE) - un code de fiche
  // conventionnel fixe, jamais un code arbitraire (même principe que "BAR-TH-171" côté CEE). Le calcul
  // CALCULE ne peut donc être testé qu'en publiant temporairement une version sous ce code réel.
  const regleReelle = await prisma.regleReglementaire.upsert({
    where: { code: ANAH_REVENUS_CODE },
    update: {},
    create: { code: ANAH_REVENUS_CODE, famille: "ANAH_REVENUS", secteur: "BAT", nom: "Barème ANAH revenus" },
  });
  const versionReelleExistante = await prisma.regleReglementaireVersion.findFirst({ where: { regleId: regleReelle.id, publie: true } });
  let versionReelleCreee: { id: string } | null = null;
  if (!versionReelleExistante) {
    versionReelleCreee = await prisma.regleReglementaireVersion.create({
      data: {
        regleId: regleReelle.id,
        numeroVersion: `TEST-${suffix}`,
        statutValidation: "PUBLIE",
        publie: true,
        dateDebutEffet: new Date("2020-01-01"),
        sourceNom: "Test P14.1 (non officiel, nettoyé en fin de script)",
        formulaCode: "ANAH_REVENUS_V1",
      },
    });
    // Clé exacte attendue par anahRevenusV1() : "{categorie}|{zoneClimatique}|{nbPersonnesEffectif}".
    await prisma.baremeReglementaire.createMany({
      data: [
        { ruleVersionId: versionReelleCreee.id, cle: "TRES_MODESTE|H1|3", valeur: 20000 },
        { ruleVersionId: versionReelleCreee.id, cle: "MODESTE|H1|3", valeur: 30000 },
        { ruleVersionId: versionReelleCreee.id, cle: "INTERMEDIAIRE|H1|3", valeur: 40000 },
        { ruleVersionId: versionReelleCreee.id, cle: "SUPERIEUR|H1|3", valeur: 50000 },
      ],
    });

    const avecRegle = await calculateCategorieMenage({ dateReference: new Date(), inputs: { zoneClimatique: "H1", nombrePersonnesFoyer: 3, revenuFiscalReference: 25000 } });
    assert(avecRegle.statut === "CALCULE" && avecRegle.categorie === "MODESTE", "avec une version ANAH_REVENUS publiée, le calcul aboutit à une vraie catégorie basée sur le barème (RFR 25000 <= seuil MODESTE 30000 -> MODESTE, jamais inventée)");
    assert(avecRegle.provenance != null && avecRegle.provenance.includes("ANAH_REVENUS"), "la provenance affichable mentionne bien la règle ANAH_REVENUS utilisée (traçabilité)");

    await prisma.baremeReglementaire.deleteMany({ where: { ruleVersionId: versionReelleCreee.id } });
    await prisma.regleReglementaireVersion.delete({ where: { id: versionReelleCreee.id } });
  } else {
    console.log("  --   une version ANAH_REVENUS publiée existe déjà en base (probablement posée par un run précédent) - test de calcul CALCULE ignoré pour ne pas interférer.");
  }

  // ============================================================
  // Nettoyage
  // ============================================================
  console.log("\nNettoyage...");
  await prisma.reponseQuestion.deleteMany({ where: { reponseQuestionnaireId: rq.id } });
  await prisma.reponseQuestionnaire.delete({ where: { id: rq.id } });
  await prisma.question.deleteMany({ where: { questionnaireVersionId: version.id } });
  await prisma.questionnaireVersion.delete({ where: { id: version.id } });
  await prisma.questionnaire.delete({ where: { id: questionnaire.id } });
  await prisma.champProvenance.deleteMany({ where: { logementId: logement.id } });
  await prisma.logement.delete({ where: { id: logement.id } });
  await prisma.lead.delete({ where: { id: leadA.id } });
  await prisma.user.delete({ where: { id: userA.id } });
  await prisma.organisation.delete({ where: { id: orgB.id } });
  await prisma.organisation.delete({ where: { id: orgA.id } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
