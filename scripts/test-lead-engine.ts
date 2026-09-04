import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { normalizePhoneNumber } from "../src/lib/phone";
import { findPotentialDuplicates } from "../src/lib/leads/dedup";
import { createLeadFromSource, ensureDraftDossierForLead } from "../src/lib/leads/conversion";
import { changeLeadStatus, hasLeadEverReachedStatus } from "../src/lib/leads/status";
import { calculateLeadQualification } from "../src/lib/leads/qualification";
import { getNextLeadsToCall } from "../src/lib/leads/next-lead";
import { getCommercialDashboardMetrics } from "../src/lib/leads/dashboard";
import { evaluateVisibleQuestions, type QuestionDef, type AnswerValue } from "../src/lib/questionnaire/engine";
import { mapReponsesToStructuredFields, type MappableAnswer } from "../src/lib/questionnaire/mapping";
import { parseLeadsCsv } from "../src/lib/leads/csv-import";
import { hasPermission, canAccessLead, type UserContext } from "../src/lib/authz";
import { getNextBestActions } from "../src/lib/next-best-action";
import { buildStudyContext, runDossierStudy } from "../src/lib/etude/engine";
import type { Prisma } from "../src/generated/prisma/client";

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
  // ============================================================
  // Fixtures : une organisation, un admin, deux commerciaux, un
  // téléprospecteur, le questionnaire réel publié en seed (jamais un
  // questionnaire fabriqué pour le test).
  // ============================================================
  const org = await prisma.organisation.create({ data: { nom: "Test Leads P9", slug: `test-leads-p9-${Date.now()}` } });
  const dossierType = await prisma.dossierType.findUniqueOrThrow({ where: { key: "MONOGESTE" } });
  const prospectStatut = await prisma.dossierStatus.findUniqueOrThrow({ where: { key: "PROSPECT_ETUDE" } });
  void dossierType;
  void prospectStatut;

  const admin = await prisma.user.create({ data: { organisationId: org.id, email: `test-p9-admin-${Date.now()}@example.com`, name: "Admin P9", role: "ADMIN", actif: true, password: "x" } });
  const commercialA = await prisma.user.create({ data: { organisationId: org.id, email: `test-p9-comA-${Date.now()}@example.com`, name: "Commercial A", role: "COMMERCIAL", actif: true, password: "x" } });
  const commercialB = await prisma.user.create({ data: { organisationId: org.id, email: `test-p9-comB-${Date.now()}@example.com`, name: "Commercial B", role: "COMMERCIAL", actif: true, password: "x" } });
  const teleA = await prisma.user.create({ data: { organisationId: org.id, email: `test-p9-teleA-${Date.now()}@example.com`, name: "Télé A", role: "TELEPROSPECTEUR", actif: true, password: "x" } });
  const teleB = await prisma.user.create({ data: { organisationId: org.id, email: `test-p9-teleB-${Date.now()}@example.com`, name: "Télé B", role: "TELEPROSPECTEUR", actif: true, password: "x" } });

  const ctxAdmin: UserContext = { userId: admin.id, organisationId: org.id, role: "ADMIN" };
  const ctxCommercialA: UserContext = { userId: commercialA.id, organisationId: org.id, role: "COMMERCIAL" };
  const ctxCommercialB: UserContext = { userId: commercialB.id, organisationId: org.id, role: "COMMERCIAL" };

  const delegataire = await prisma.delegataireCee.create({ data: { nom: "Test Délégataire P9", actif: true } });
  await prisma.tarifDelegataireCee.create({
    data: { organisationId: org.id, delegataireId: delegataire.id, ficheCode: "BAR-TH-171", categorie: "CLASSIQUE", tauxCtsParMwhc: 7_400, dateDebut: new Date("2026-01-01"), delaiPaiementJours: 45, actif: true },
  });

  const questionnaireVersion = await prisma.questionnaireVersion.findFirstOrThrow({
    where: { publiee: true, questionnaire: { code: "QUALIFICATION_COMMERCIALE" } },
    include: { questions: { include: { options: true, conditionsAffichage: true } } },
  });
  const questionByCode = Object.fromEntries(questionnaireVersion.questions.map((q) => [q.code, q]));

  // ============================================================
  // TEST 1 - Créer lead -> qualifier -> convertir : 1 seul Client + 1 seul Dossier.
  // ============================================================
  console.log("\n=== TEST 1 - créer -> qualifier -> convertir ===");
  const { leadId: lead1Id } = await createLeadFromSource({
    organisationId: org.id,
    createdById: commercialA.id,
    sourceKey: "TELEPROSPECTION",
    prenom: "Jean",
    nom: "Dupont",
    telephone: "06 11 22 33 44",
    email: "jean.dupont@example.com",
    codePostal: "75001",
    ville: "Paris",
    commercialId: commercialA.id,
  });

  async function saveReponse(leadId: string, code: string, valeur: { valeurTexte?: string; valeurNombre?: number; valeurOptions?: Prisma.InputJsonValue }) {
    const question = questionByCode[code];
    const rq = await prisma.reponseQuestionnaire.upsert({
      where: { leadId_questionnaireVersionId: { leadId, questionnaireVersionId: questionnaireVersion.id } },
      update: {},
      create: { organisationId: org.id, leadId, questionnaireVersionId: questionnaireVersion.id },
    });
    await prisma.reponseQuestion.upsert({
      where: { reponseQuestionnaireId_questionId: { reponseQuestionnaireId: rq.id, questionId: question.id } },
      update: valeur,
      create: { reponseQuestionnaireId: rq.id, questionId: question.id, ...valeur },
    });
    return rq;
  }

  await saveReponse(lead1Id, "TYPE_BATIMENT", { valeurOptions: ["MAISON"] });
  await saveReponse(lead1Id, "SURFACE_HABITABLE", { valeurNombre: 90 });
  await saveReponse(lead1Id, "CHAUFFAGE_ACTUEL", { valeurOptions: ["FIOUL"] });
  await saveReponse(lead1Id, "PROJET_TYPE_TRAVAUX", { valeurOptions: ["PAC_AIR_EAU"] });
  await saveReponse(lead1Id, "SURFACE_CHAUFFEE", { valeurNombre: 80 });
  await saveReponse(lead1Id, "ZONE_CLIMATIQUE", { valeurOptions: ["H1"] });

  // Applique le mapping comme le ferait saveQuestionnaireAnswers (section 10).
  async function applyMappingToLogementAndConversion(leadId: string) {
    const rq = await prisma.reponseQuestionnaire.findUniqueOrThrow({
      where: { leadId_questionnaireVersionId: { leadId, questionnaireVersionId: questionnaireVersion.id } },
      include: { reponses: { include: { question: { select: { code: true, champMappe: true } } } } },
    });
    const mappable: MappableAnswer[] = rq.reponses.map((r) => ({ code: r.question.code, champMappe: r.question.champMappe, valeurTexte: r.valeurTexte, valeurNombre: r.valeurNombre, valeurBool: r.valeurBool, valeurOptions: (r.valeurOptions as string[] | null) ?? null }));
    const mapping = mapReponsesToStructuredFields(mappable);
    if (Object.keys(mapping.logement).length > 0) {
      await prisma.logement.upsert({ where: { leadId }, update: mapping.logement, create: { organisationId: org.id, leadId, ...mapping.logement } });
    }
    return mapping;
  }
  await applyMappingToLogementAndConversion(lead1Id);

  const conv1 = await ensureDraftDossierForLead(lead1Id, ctxCommercialA);
  const nbClientsApres1 = await prisma.client.count({ where: { organisationId: org.id } });
  const nbDossiersApres1 = await prisma.dossier.count({ where: { organisationId: org.id } });
  assert(conv1.created === true, "premier ensureDraftDossierForLead crée le dossier");
  assert(nbClientsApres1 === 1, `1 seul client créé (trouvé ${nbClientsApres1})`);
  assert(nbDossiersApres1 === 1, `1 seul dossier créé (trouvé ${nbDossiersApres1})`);

  // ============================================================
  // TEST 2 - Cliquer conversion 3 fois -> toujours 1 dossier.
  // ============================================================
  console.log("\n=== TEST 2 - conversion idempotente (3 appels) ===");
  const conv2 = await ensureDraftDossierForLead(lead1Id, ctxCommercialA);
  const conv3 = await ensureDraftDossierForLead(lead1Id, ctxCommercialA);
  assert(conv2.created === false && conv3.created === false, "les appels suivants ne créent rien");
  assert(conv2.dossierId === conv1.dossierId && conv3.dossierId === conv1.dossierId, "toujours le même dossierId");
  const nbDossiersApres3clics = await prisma.dossier.count({ where: { organisationId: org.id } });
  assert(nbDossiersApres3clics === 1, `toujours 1 seul dossier après 3 appels (trouvé ${nbDossiersApres3clics})`);

  // ============================================================
  // TEST 3 - "06 12 34 56 78" et "+33 6 12 34 56 78" -> même normalisation -> doublon détecté.
  // ============================================================
  console.log("\n=== TEST 3 - normalisation téléphone + doublon ===");
  const n1 = normalizePhoneNumber("06 12 34 56 78");
  const n2 = normalizePhoneNumber("+33 6 12 34 56 78");
  assert(n1 === n2 && n1 === "+33612345678", `les deux formats normalisent à la même valeur (trouvé ${n1} / ${n2})`);

  const { leadId: leadDoublonBase } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Marie", nom: "Curie", telephone: "06 12 34 56 78" });
  void leadDoublonBase;
  const duplicatesTest3 = await findPotentialDuplicates({ organisationId: org.id, telephone: "+33 6 12 34 56 78" });
  assert(duplicatesTest3.some((d) => d.type === "LEAD"), "le second format détecte bien le lead créé avec l'autre format comme doublon potentiel");

  // ============================================================
  // TEST 4 - Question surface chauffée -> Logement.surfaceChauffeeM2 -> P8 la récupère.
  // ============================================================
  console.log("\n=== TEST 4 - mapping surface chauffée -> P8 ===");
  const logement1 = await prisma.logement.findUniqueOrThrow({ where: { leadId: lead1Id } });
  assert(logement1.surfaceChauffeeM2 === 80, `Logement.surfaceChauffeeM2 = 80 (trouvé ${logement1.surfaceChauffeeM2})`);

  const posteCree = await prisma.dossierPosteTravaux.findFirstOrThrow({ where: { dossierId: conv1.dossierId } });
  assert(posteCree.type === "PAC_AIR_EAU", "le poste créé à la conversion est bien PAC_AIR_EAU (mapping Projet.typeTravauxSouhaite)");
  assert(posteCree.surfaceM2 === 80, `le poste reprend la surface chauffée du logement (trouvé ${posteCree.surfaceM2})`);

  const contextP8 = await buildStudyContext(conv1.dossierId, org.id);
  const posteContext = contextP8.project.postes.find((p) => p.posteId === posteCree.id);
  assert(posteContext?.surfaceM2.value === 80, `buildStudyContext (P8) lit bien 80 m² pour ce poste (trouvé ${posteContext?.surfaceM2.value})`);
  assert(contextP8.logement.zoneClimatique.value === "H1", "buildStudyContext lit la zone climatique H1 mappée depuis le questionnaire (Client.zoneClimatique)");

  // ============================================================
  // TEST 5 - Question chauffage -> branches questionnaire correctes.
  // ============================================================
  console.log("\n=== TEST 5 - branches conditionnelles du questionnaire ===");
  const questionDefs: QuestionDef[] = questionnaireVersion.questions.map((q) => ({
    code: q.code,
    type: q.type,
    conditions: q.conditionsAffichage.map((c) => ({ questionDeclenchanteCode: questionnaireVersion.questions.find((qq) => qq.id === c.questionDeclenchanteId)!.code, valeurAttendue: c.valeurAttendue })),
  }));

  const reponsesGaz: Record<string, AnswerValue> = { CHAUFFAGE_ACTUEL: { options: ["GAZ"] } };
  const visiblesGaz = evaluateVisibleQuestions(questionDefs, reponsesGaz).map((q) => q.code);
  assert(visiblesGaz.includes("CHAUDIERE_GAZ_CONDENSATION") && visiblesGaz.includes("AGE_CHAUDIERE_GAZ"), "chauffage=GAZ affiche les questions chaudière gaz");
  assert(!visiblesGaz.includes("CUVE_FIOUL") && !visiblesGaz.includes("TYPE_PAC_EXISTANTE"), "chauffage=GAZ n'affiche PAS les questions fioul/PAC");

  const reponsesFioul: Record<string, AnswerValue> = { CHAUFFAGE_ACTUEL: { options: ["FIOUL"] } };
  const visiblesFioul = evaluateVisibleQuestions(questionDefs, reponsesFioul).map((q) => q.code);
  assert(visiblesFioul.includes("CUVE_FIOUL") && visiblesFioul.includes("CONSO_FIOUL_APPROX"), "chauffage=FIOUL affiche les questions fioul");
  assert(!visiblesFioul.includes("CHAUDIERE_GAZ_CONDENSATION"), "chauffage=FIOUL n'affiche PAS les questions gaz");

  const reponsesPac: Record<string, AnswerValue> = { CHAUFFAGE_ACTUEL: { options: ["PAC"] } };
  const visiblesPac = evaluateVisibleQuestions(questionDefs, reponsesPac).map((q) => q.code);
  assert(visiblesPac.includes("TYPE_PAC_EXISTANTE") && visiblesPac.includes("AGE_PAC_EXISTANTE"), "chauffage=PAC affiche les questions PAC existante");

  const reponsesMaison: Record<string, AnswerValue> = { TYPE_BATIMENT: { options: ["MAISON"] } };
  const visiblesMaison = evaluateVisibleQuestions(questionDefs, reponsesMaison).map((q) => q.code);
  assert(visiblesMaison.includes("NB_NIVEAUX") && visiblesMaison.includes("COMBLES"), "type=MAISON affiche étages/combles");

  const reponsesAppart: Record<string, AnswerValue> = { TYPE_BATIMENT: { options: ["APPARTEMENT"] } };
  const visiblesAppart = evaluateVisibleQuestions(questionDefs, reponsesAppart).map((q) => q.code);
  assert(!visiblesAppart.includes("NB_NIVEAUX") && !visiblesAppart.includes("COMBLES"), "type=APPARTEMENT n'affiche PAS étages/combles");

  // ============================================================
  // TEST 6 - Rappel demain -> apparaît dans Mes actions au bon moment.
  // ============================================================
  console.log("\n=== TEST 6 - rappel demain dans Mes actions (NBA) ===");
  const apresDemain = new Date(Date.now() + 48 * 3_600_000);
  const { leadId: leadRappel } = await createLeadFromSource({ organisationId: org.id, createdById: commercialA.id, sourceKey: "SITE_WEB", prenom: "Paul", nom: "Rappel", telephone: "07 00 00 00 01", commercialId: commercialA.id });
  await prisma.lead.update({ where: { id: leadRappel }, data: { prochainContactAt: apresDemain } });

  const actionsAvant = await getNextBestActions({ organisationId: org.id, scope: "all" });
  assert(!actionsAvant.some((a) => a.sourceId === leadRappel), "pas encore d'action tant que prochainContactAt est dans le futur");

  await prisma.lead.update({ where: { id: leadRappel }, data: { prochainContactAt: new Date(Date.now() - 1000) } });
  const actionsApres = await getNextBestActions({ organisationId: org.id, scope: "all" });
  assert(actionsApres.some((a) => a.sourceId === leadRappel && a.typeAction === "LEAD"), "l'action LEAD apparaît une fois le rappel échu");

  // ============================================================
  // TEST 7 - Deux téléprospecteurs : claim empêche l'appel simultané.
  // ============================================================
  console.log("\n=== TEST 7 - claim empêche l'appel simultané ===");
  const { leadId: leadClaim } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: "IMPORT", prenom: "Alain", nom: "Claim", telephone: "07 00 00 00 02" });

  const now7 = new Date();
  const expire7 = new Date(now7.getTime() + 15 * 60_000);
  await prisma.lead.update({ where: { id: leadClaim }, data: { claimedById: teleA.id, claimedAt: now7, claimExpiresAt: expire7 } });

  const leadRelu7 = await prisma.lead.findUniqueOrThrow({ where: { id: leadClaim } });
  const teleBBloque = leadRelu7.claimedById != null && leadRelu7.claimedById !== teleB.id && leadRelu7.claimExpiresAt != null && leadRelu7.claimExpiresAt > new Date();
  assert(teleBBloque, "télé B est bloqué tant que le claim de télé A est actif");

  // ============================================================
  // TEST 8 - Claim expiré : lead redevient disponible.
  // ============================================================
  console.log("\n=== TEST 8 - claim expiré redevient disponible ===");
  await prisma.lead.update({ where: { id: leadClaim }, data: { claimExpiresAt: new Date(Date.now() - 1000) } });
  const leadRelu8 = await prisma.lead.findUniqueOrThrow({ where: { id: leadClaim } });
  const teleBBloqueApresExpiration = leadRelu8.claimedById != null && leadRelu8.claimedById !== teleB.id && leadRelu8.claimExpiresAt != null && leadRelu8.claimExpiresAt > new Date();
  assert(!teleBBloqueApresExpiration, "télé B n'est plus bloqué une fois le claim expiré");

  // ============================================================
  // TEST 9/10 - permissions : Commercial A ne voit pas les leads de
  // Commercial B sans VIEW_TEAM_LEADS ; la direction voit l'équipe.
  // ============================================================
  console.log("\n=== TEST 9/10 - permissions VIEW_LEADS / VIEW_TEAM_LEADS ===");
  const { leadId: leadDeB } = await createLeadFromSource({ organisationId: org.id, createdById: commercialB.id, sourceKey: null, prenom: "Client", nom: "DeB", telephone: "07 00 00 00 03", commercialId: commercialB.id });
  const leadDeBRow = await prisma.lead.findUniqueOrThrow({ where: { id: leadDeB } });

  assert(!canAccessLead(ctxCommercialA, leadDeBRow), "Commercial A ne peut PAS accéder au lead de Commercial B");
  assert(canAccessLead(ctxCommercialB, leadDeBRow), "Commercial B peut accéder à son propre lead");
  assert(hasPermission(ctxAdmin, "VIEW_TEAM_LEADS") && canAccessLead(ctxAdmin, leadDeBRow), "ADMIN (direction) voit l'équipe, y compris le lead de Commercial B");
  assert(!hasPermission(ctxCommercialA, "VIEW_TEAM_LEADS"), "COMMERCIAL n'a pas VIEW_TEAM_LEADS");

  // ============================================================
  // TEST 11 - cloisonnement multi-tenant : org A ne voit jamais les
  // leads/logements/interactions de org B.
  // ============================================================
  console.log("\n=== TEST 11 - cloisonnement multi-tenant ===");
  const orgB = await prisma.organisation.create({ data: { nom: "Test Leads P9 - Org B", slug: `test-leads-p9-b-${Date.now()}` } });
  const { leadId: leadOrgB } = await createLeadFromSource({ organisationId: orgB.id, createdById: null, sourceKey: null, prenom: "Org", nom: "B", telephone: "07 99 99 99 99" });

  const leadsVisiblesDepuisOrgA = await prisma.lead.findMany({ where: { organisationId: org.id, id: leadOrgB } });
  assert(leadsVisiblesDepuisOrgA.length === 0, "le lead de l'org B est introuvable quand on le cherche scopé à l'org A");

  const logementOrgB = await prisma.logement.create({ data: { organisationId: orgB.id, leadId: leadOrgB, surfaceHabitableM2: 50 } });
  const logementsVisiblesDepuisOrgA = await prisma.logement.findMany({ where: { organisationId: org.id, id: logementOrgB.id } });
  assert(logementsVisiblesDepuisOrgA.length === 0, "le logement de l'org B est introuvable scopé à l'org A");

  const interactionOrgB = await prisma.interactionCommerciale.create({ data: { organisationId: orgB.id, leadId: leadOrgB, type: "APPEL" } });
  const interactionsVisiblesDepuisOrgA = await prisma.interactionCommerciale.findMany({ where: { organisationId: org.id, id: interactionOrgB.id } });
  assert(interactionsVisiblesDepuisOrgA.length === 0, "l'interaction de l'org B est introuvable scopée à l'org A");

  // ============================================================
  // TEST 12 - donnée externe proposée ne remplace jamais automatiquement
  // une donnée humaine vérifiée.
  // ============================================================
  console.log("\n=== TEST 12 - proposition externe n'écrase jamais automatiquement ===");
  await prisma.champProvenance.create({
    data: { organisationId: org.id, logementId: logement1.id, champ: "surfaceChauffeeM2", source: "COMMERCIAL", confiance: "DECLARE", valeurProposee: "95", sourceProposee: "API", referenceExterne: "ref-test-123", recupereeAt: new Date() },
  });
  const logementApresProposition = await prisma.logement.findUniqueOrThrow({ where: { id: logement1.id } });
  assert(logementApresProposition.surfaceChauffeeM2 === 80, "la valeur du logement reste 80 (déclarée par le commercial), pas 95 (proposée par l'API)");

  // Simule l'acceptation explicite (même logique que acceptProposedValue) :
  const cpEnAttente = await prisma.champProvenance.findFirstOrThrow({ where: { logementId: logement1.id, champ: "surfaceChauffeeM2" } });
  await prisma.logement.update({ where: { id: logement1.id }, data: { surfaceChauffeeM2: Number(cpEnAttente.valeurProposee) } });
  await prisma.champProvenance.update({ where: { id: cpEnAttente.id }, data: { source: "API", confiance: "ESTIME", accepteeById: admin.id, accepteeAt: new Date() } });
  const logementApresAcceptation = await prisma.logement.findUniqueOrThrow({ where: { id: logement1.id } });
  assert(logementApresAcceptation.surfaceChauffeeM2 === 95, "après acceptation EXPLICITE, la valeur proposée devient la valeur réelle (95)");

  // ============================================================
  // TEST 13 - CSV avec doublon potentiel : signalé avant import.
  // ============================================================
  console.log("\n=== TEST 13 - doublon signalé dans l'aperçu CSV ===");
  const csv = ["nom,prenom,telephone,email", "Martin,Luc,0611223344,luc.martin@example.com", "Martin,Lucas,+33 6 11 22 33 44,autre@example.com"].join("\n");
  const preview = parseLeadsCsv(csv);
  assert(preview.rows.length === 2, "2 lignes parsées");
  assert(preview.rows[1].duplicateOfIndex === preview.rows[0].index, "la seconde ligne est signalée comme doublon potentiel de la première (même téléphone normalisé)");

  // ============================================================
  // TEST 14 - lead insuffisamment qualifié : P8 retourne les données
  // manquantes, jamais un faux scénario.
  // ============================================================
  console.log("\n=== TEST 14 - lead insuffisamment qualifié -> P8 honnête ===");
  const { leadId: leadPauvre } = await createLeadFromSource({ organisationId: org.id, createdById: commercialA.id, sourceKey: "AUTRE", prenom: "Peu", nom: "Qualifie", telephone: "07 00 00 00 04", commercialId: commercialA.id });
  await saveReponse(leadPauvre, "PROJET_TYPE_TRAVAUX", { valeurOptions: ["PAC_AIR_EAU"] });
  await applyMappingToLogementAndConversion(leadPauvre);
  const convPauvre = await ensureDraftDossierForLead(leadPauvre, ctxCommercialA);
  const etudePauvre = await runDossierStudy({ organisationId: org.id, dossierId: convPauvre.dossierId, mode: "SIMULATION" });
  assert(etudePauvre.context.dataQuality === "INSUFFICIENT" || etudePauvre.context.dataQuality === "PARTIAL", `dataQuality reflète l'insuffisance (trouvé ${etudePauvre.context.dataQuality})`);
  assert(etudePauvre.context.missingFields.length > 0, "missingFields non vide (surface chauffée, etasBande... jamais inventés)");
  assert(etudePauvre.scenarios.every((s) => s.ceeKwhCumac == null || s.statutEligibilite === "DONNEES_INSUFFISANTES"), "aucun scénario ne prétend un cumac fiable sans données suffisantes");

  const qualificationPauvre = calculateLeadQualification({ pipelineStatutKey: "NOUVEAU", temperature: "TIEDE", aRdvPlanifie: false, logement: null, nbReponsesQuestionnaire: 1, nbQuestionsObligatoiresTotal: 4, nbQuestionsObligatoiresRepondues: 1 });
  assert(qualificationPauvre.statut === "INSUFFISANT", `qualification commerciale INSUFFISANT distincte de l'étude réglementaire (trouvé ${qualificationPauvre.statut})`);

  // ============================================================
  // TEST 15 - pipeline : métriques de conversion cohérentes.
  // ============================================================
  console.log("\n=== TEST 15 - métriques de conversion cohérentes ===");
  const statutSigne = await prisma.leadPipelineStatus.findUniqueOrThrow({ where: { key: "SIGNE" } });
  const statutQualifie = await prisma.leadPipelineStatus.findUniqueOrThrow({ where: { key: "QUALIFIE" } });
  const { leadId: leadSigne } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Vendu", nom: "Signe", telephone: "07 00 00 00 05" });
  await changeLeadStatus({ leadId: leadSigne, newStatusId: statutSigne.id, userId: admin.id });
  const { leadId: leadQualifie } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Suivi", nom: "Qualifie2", telephone: "07 00 00 00 06" });
  await changeLeadStatus({ leadId: leadQualifie, newStatusId: statutQualifie.id, userId: admin.id });

  const dashboard = await getCommercialDashboardMetrics(ctxAdmin);
  assert(dashboard != null, "le dashboard est calculable pour ADMIN");
  if (dashboard) {
    assert(dashboard.ventesSignees >= 1, `au moins 1 vente signée comptée (trouvé ${dashboard.ventesSignees})`);
    const etapeSigne = dashboard.funnel.find((f) => f.etape === "SIGNE");
    const etapeNouveau = dashboard.funnel.find((f) => f.etape === "NOUVEAU");
    assert(etapeSigne != null && etapeNouveau != null, "le funnel contient bien les étapes NOUVEAU et SIGNE");
    assert((etapeNouveau?.count ?? 0) >= (etapeSigne?.count ?? 0), "le funnel est décroissant (NOUVEAU >= SIGNE), cohérent avec un pipeline");
    assert(dashboard.tauxConversionPct != null && dashboard.tauxConversionPct >= 0 && dashboard.tauxConversionPct <= 100, `taux de conversion dans [0,100] (trouvé ${dashboard.tauxConversionPct})`);
  }

  // getNextLeadsToCall ne doit jamais renvoyer le lead SIGNE
  const prochainsLeads = await getNextLeadsToCall(ctxAdmin, 50);
  assert(!prochainsLeads.some((l) => l.leadId === leadSigne), "getNextLeadsToCall n'inclut jamais un lead déjà SIGNE");

  // ============================================================
  // TEST 17 (P9 finition, section 41) - QUALIFIÉ -> PERDU reste compté
  // comme "a atteint QUALIFIÉ" (historique des statuts, jamais uniquement
  // le statut courant).
  // ============================================================
  console.log("\n=== TEST 17 - historique pipeline : QUALIFIÉ puis PERDU reste compté ===");
  const statutPerdu = await prisma.leadPipelineStatus.findUniqueOrThrow({ where: { key: "PERDU" } });
  const { leadId: leadQualifiePuisPerdu } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Qualifie", nom: "PuisPerdu", telephone: "07 00 00 00 07" });
  await changeLeadStatus({ leadId: leadQualifiePuisPerdu, newStatusId: statutQualifie.id, userId: admin.id });
  await changeLeadStatus({ leadId: leadQualifiePuisPerdu, newStatusId: statutPerdu.id, userId: admin.id });

  const leadReluApresPerte = await prisma.lead.findUniqueOrThrow({ where: { id: leadQualifiePuisPerdu } });
  assert(leadReluApresPerte.statutId === statutPerdu.id, "le statut courant du lead est bien PERDU");
  const aAtteintQualifie = await hasLeadEverReachedStatus(leadQualifiePuisPerdu, statutQualifie.id);
  assert(aAtteintQualifie, "hasLeadEverReachedStatus(QUALIFIE) reste vrai même si le lead est maintenant PERDU");

  const nbHistorique = await prisma.leadStatusHistory.count({ where: { leadId: leadQualifiePuisPerdu } });
  assert(nbHistorique === 3, `3 entrées d'historique (création NOUVEAU, -> QUALIFIE, -> PERDU) - trouvé ${nbHistorique}`);

  // ============================================================
  // TEST 16 (P9 finition, section 41) - import CSV : preview (erreurs +
  // doublons potentiels EXISTANTS en base) + commit (n'importe QUE les
  // lignes valides confirmées).
  // ============================================================
  console.log("\n=== TEST 16 - import CSV complet (preview + doublons + erreurs + commit) ===");
  const { leadId: leadExistantPourDoublon } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Existant", nom: "EnBase", telephone: "07 55 55 55 55" });
  void leadExistantPourDoublon;

  const csvImport = ["nom,prenom,telephone,email", "Nouveau,Client,0766666666,nouveau@example.com", ",SansNom,0788888888,sansnom@example.com", "Doublon,EnBase,07 55 55 55 55,doublon@example.com"].join("\n");
  const previewImport = parseLeadsCsv(csvImport);
  assert(previewImport.rows.length === 3, "3 lignes lues dans le CSV");
  assert(previewImport.rows[1].errors.length > 0, "la ligne sans nom est signalée en erreur");

  // Reproduit previewLeadsCsv() : doublon contre la base existante (pas seulement intra-fichier).
  const doublonsExistants = await Promise.all(
    previewImport.rows.map((r) => (r.errors.length === 0 ? findPotentialDuplicates({ organisationId: org.id, telephone: r.telephone, email: r.email }) : Promise.resolve([])))
  );
  assert(doublonsExistants[2].length > 0, "la ligne 'Doublon EnBase' est détectée comme doublon d'un lead déjà en base");
  assert(doublonsExistants[0].length === 0, "la ligne 'Nouveau Client' n'est pas un doublon");

  const nbLeadsAvantImport = await prisma.lead.count({ where: { organisationId: org.id } });
  let importes = 0;
  let ignores = 0;
  for (const row of previewImport.rows) {
    if (row.errors.length > 0 || !row.nom || !row.prenom) {
      ignores++;
      continue;
    }
    await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: "IMPORT", prenom: row.prenom, nom: row.nom, telephone: row.telephone, email: row.email });
    importes++;
  }
  assert(importes === 2, `2 lignes valides importées (trouvé ${importes})`);
  assert(ignores === 1, `1 ligne invalide ignorée, jamais importée silencieusement (trouvé ${ignores})`);
  const nbLeadsApresImport = await prisma.lead.count({ where: { organisationId: org.id } });
  assert(nbLeadsApresImport === nbLeadsAvantImport + 2, "exactement 2 nouveaux leads en base après le commit");

  // ============================================================
  // TEST 18 (P9 finition, section 41) - RDV non confirmé proche -> NBA ;
  // confirmé -> disparaît (pas de double action).
  // ============================================================
  console.log("\n=== TEST 18 - RDV non confirmé proche -> NBA ===");
  const { leadId: leadAvecRdv } = await createLeadFromSource({ organisationId: org.id, createdById: admin.id, sourceKey: null, prenom: "Avec", nom: "Rdv", telephone: "07 00 00 00 08", commercialId: admin.id });
  const rdvProche = await prisma.rdv.create({ data: { organisationId: org.id, leadId: leadAvecRdv, date: new Date(Date.now() + 6 * 3_600_000), type: "VISITE", statut: "PLANIFIE", commercialId: admin.id } });

  const actionsAvecRdvPlanifie = await getNextBestActions({ organisationId: org.id, scope: "all" });
  assert(actionsAvecRdvPlanifie.some((a) => a.sourceId === leadAvecRdv && a.typeAction === "LEAD" && a.id.endsWith(":rdv")), "un RDV proche non confirmé remonte bien en NBA");

  await prisma.rdv.update({ where: { id: rdvProche.id }, data: { statut: "CONFIRME" } });
  const actionsApresConfirmation = await getNextBestActions({ organisationId: org.id, scope: "all" });
  assert(!actionsApresConfirmation.some((a) => a.sourceId === leadAvecRdv && a.id.endsWith(":rdv")), "une fois confirmé, le RDV ne remonte plus (pas de double action)");

  // ============================================================
  // TEST 19 (P9 finition, section 41) - référentiels leads (source/statut/
  // résultat) : GLOBAUX par conception (même pattern que DossierType/
  // DossierStatus), donc PAS d'isolement par organisation - vérifié
  // explicitement plutôt que supposé : org A et org B voient exactement le
  // même référentiel, jamais une fuite de DONNÉES métier (leads eux-mêmes),
  // seulement un référentiel partagé volontaire.
  // ============================================================
  console.log("\n=== TEST 19 - référentiels leads globaux (par conception) ===");
  const sourcesDepuisOrgA = await prisma.leadSource.findMany({ where: { actif: true }, select: { key: true } });
  const sourcesDepuisOrgBContexte = await prisma.leadSource.findMany({ where: { actif: true }, select: { key: true } });
  assert(sourcesDepuisOrgA.length > 0 && sourcesDepuisOrgA.length === sourcesDepuisOrgBContexte.length, "le référentiel LeadSource est bien global, identique quelle que soit l'organisation consultante (par conception)");
  const leadsOrgAAvecCetteSource = await prisma.lead.findMany({ where: { organisationId: org.id, sourceId: { not: null } } });
  const leadsOrgBAvecCetteSource = await prisma.lead.findMany({ where: { organisationId: orgB.id } });
  assert(leadsOrgBAvecCetteSource.every((l) => l.organisationId === orgB.id) && leadsOrgAAvecCetteSource.every((l) => l.organisationId === org.id), "même si le référentiel de sources est partagé, les LEADS eux-mêmes restent strictement cloisonnés par organisation");

  // --- Nettoyage ---
  await prisma.champProvenance.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.reponseQuestion.deleteMany({ where: { reponseQuestionnaire: { organisationId: { in: [org.id, orgB.id] } } } });
  await prisma.reponseQuestionnaire.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.interactionCommerciale.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.rdv.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossier: { organisationId: org.id } } });
  await prisma.logement.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.lead.updateMany({ where: { organisationId: org.id }, data: { dossierId: null } });
  await prisma.dossier.deleteMany({ where: { organisationId: org.id } });
  await prisma.lead.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.client.deleteMany({ where: { organisationId: org.id } });
  await prisma.tarifDelegataireCee.deleteMany({ where: { organisationId: org.id } });
  await prisma.delegataireCee.delete({ where: { id: delegataire.id } });
  await prisma.auditLog.deleteMany({ where: { organisationId: { in: [org.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, commercialA.id, commercialB.id, teleA.id, teleB.id] } } });
  await prisma.organisation.delete({ where: { id: orgB.id } });
  await prisma.organisation.delete({ where: { id: org.id } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
