import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAutomationRule, toRuleData } from "../src/lib/automations/engine";
import { renderTemplate, validateTemplateVariables, UnknownTemplateVariableError } from "../src/lib/automations/templates";
import { emitDomainEvent, signWebhookPayload, isWebhookSendEnabled } from "../src/lib/webhooks/service";
import { getPartnerDossiers, getPartnerPackages } from "../src/lib/partners/access";
import { hasPermission, isPartnerRole, canAccessDossierCommunication, canAccessPackageAsPartner, type UserContext } from "../src/lib/authz";
import { isStudyStale, buildStudyContext } from "../src/lib/etude/engine";

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
  // Fixtures : organisation isolée, référentiels réels, un dossier
  // principal et les entités partenaires nécessaires aux tests 41/44/45.
  // ============================================================
  const org = await prisma.organisation.create({ data: { nom: "Test Automations P11", slug: `test-automations-p11-${Date.now()}` } });
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatus = await prisma.dossierStatus.findFirstOrThrow();

  const admin = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-admin-${Date.now()}@example.com`, name: "Admin P11", role: "ADMIN", actif: true, password: "x" } });
  const administratif = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-administratif-${Date.now()}@example.com`, name: "Administratif P11", role: "ADMINISTRATIF", actif: true, password: "x" } });
  const commercial = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-commercial-${Date.now()}@example.com`, name: "Commercial P11", role: "COMMERCIAL", actif: true, password: "x" } });
  const commercialB = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-commercialB-${Date.now()}@example.com`, name: "Commercial B P11", role: "COMMERCIAL", actif: true, password: "x" } });
  const compta = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-compta-${Date.now()}@example.com`, name: "Compta P11", role: "COMPTABILITE", actif: true, password: "x" } });

  const sousTraitantA = await prisma.sousTraitant.create({ data: { nom: "Test ST A" } });
  const sousTraitantB = await prisma.sousTraitant.create({ data: { nom: "Test ST B" } });
  const userSousTraitantA = await prisma.user.create({ data: { organisationId: org.id, email: `test-p11-sta-${Date.now()}@example.com`, name: "Sous-traitant A", role: "SOUS_TRAITANT", actif: true, password: "x", sousTraitantId: sousTraitantA.id } });

  const ctxAdmin: UserContext = { userId: admin.id, organisationId: org.id, role: "ADMIN" };
  const ctxCommercial: UserContext = { userId: commercial.id, organisationId: org.id, role: "COMMERCIAL" };
  const ctxSousTraitantA: UserContext = { userId: userSousTraitantA.id, organisationId: org.id, role: "SOUS_TRAITANT", sousTraitantId: sousTraitantA.id };

  const client1 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "Automations", email: "client-test-p11@example.com" } });
  const dossier1 = await prisma.dossier.create({
    data: { reference: `TEST-P11-${Math.random().toString(36).slice(2, 8)}`, clientId: client1.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 1_000_000, createdById: commercial.id },
  });

  // ============================================================
  // TEST 36 - document manquant : runScheduledAutomations (via
  // runAutomationRule direct) -> 1 draft email, exécuté 3 fois, toujours 1
  // seule occurrence grâce à l'idempotence.
  // ============================================================
  console.log("\n=== TEST 36 - document manquant : idempotence sur 3 exécutions ===");
  const typeDoc36 = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_TEST36", nom: "Pièce test 36" } });
  await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeDoc36.id, obligatoire: true, responsable: "CLIENT" } });
  const rule36 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_DOC_MANQUANT_J0", nom: "Test doc manquant J0", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 0 }, actionType: "PREPARE_DOCUMENT_REQUEST", actionConfig: {}, delayJours: 0, mode: "PREPARE_ONLY", actif: true },
  });

  for (let i = 0; i < 3; i++) {
    await runAutomationRule(toRuleData(rule36), {});
  }
  const drafts36 = await prisma.emailDraft.findMany({ where: { dossierId: dossier1.id } });
  const executions36 = await prisma.automationExecution.findMany({ where: { ruleId: rule36.id, entityId: dossier1.id } });
  assert(drafts36.length === 1, `exactement 1 draft email créé après 3 exécutions (trouvé ${drafts36.length})`);
  assert(executions36.length === 1, `exactement 1 AutomationExecution enregistrée (trouvé ${executions36.length})`);
  assert(drafts36[0].destinataire === "client-test-p11@example.com", "le draft cible bien l'email du client");

  // ============================================================
  // TEST 37 - document refusé -> préparation d'une relance avec motif,
  // aucune donnée interne sensible.
  // ============================================================
  console.log("\n=== TEST 37 - document refusé -> relance avec motif ===");
  const typeDoc37 = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_TEST37", nom: "Pièce test 37" } });
  const req37 = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeDoc37.id, obligatoire: true, responsable: "CLIENT" } });
  await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", nomFichier: "piece-refusee.pdf", cheminFichier: "test/piece-refusee.pdf", mimeType: "application/pdf", tailleOctets: 100, organisationId: org.id, typeDocumentId: typeDoc37.id, requirementId: req37.id, statut: "REFUSE", rejectionReason: "Document illisible.", provenance: "COMMERCIAL", createdById: commercial.id },
  });
  const rule37 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_DOC_REFUSE_EMAIL", nom: "Test doc refusé email", triggerType: "DOCUMENT_REJECTED", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "PIECE_REFUSEE" }, mode: "PREPARE_ONLY", actif: true },
  });
  const summary37 = await runAutomationRule(toRuleData(rule37), {});
  assert(summary37.executed === 1, `1 exécution réussie (trouvé ${summary37.executed})`);
  const draft37 = await prisma.emailDraft.findFirst({ where: { organisationId: org.id, dossierId: dossier1.id, sujet: { contains: dossier1.reference } }, orderBy: { createdAt: "desc" } });
  assert(draft37 != null && draft37.corps.includes("Document illisible."), "le motif de refus apparaît bien dans l'email préparé");
  assert(draft37 != null && !draft37.corps.match(/marge|taux interne|commission/i), "aucune donnée interne sensible dans l'email préparé");

  // ============================================================
  // TEST 38 - RDV sous 24h -> notification ; une fois confirmé, plus de
  // notification (pas de doublon).
  // ============================================================
  console.log("\n=== TEST 38 - RDV sous 24h -> notification, jamais de doublon après confirmation ===");
  const rdv38 = await prisma.rdv.create({ data: { organisationId: org.id, dossierId: dossier1.id, date: new Date(Date.now() + 6 * 3_600_000), type: "VISITE", statut: "PLANIFIE", commercialId: commercial.id } });
  const rule38 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_RDV_24H", nom: "Test RDV 24h", triggerType: "APPOINTMENT_UPCOMING", triggerConfig: { withinHours: 24 }, actionType: "CREATE_NOTIFICATION", actionConfig: { title: "RDV proche", message: "Un RDV a lieu bientôt." }, mode: "PREPARE_ONLY", actif: true },
  });
  await runAutomationRule(toRuleData(rule38), {});
  const notifs38Avant = await prisma.notification.count({ where: { userId: commercial.id, entityId: rdv38.id } });
  assert(notifs38Avant === 1, `1 notification créée pour le RDV proche (trouvé ${notifs38Avant})`);

  await prisma.rdv.update({ where: { id: rdv38.id }, data: { statut: "CONFIRME" } });
  await runAutomationRule(toRuleData(rule38), {});
  const notifs38Apres = await prisma.notification.count({ where: { userId: commercial.id, entityId: rdv38.id } });
  assert(notifs38Apres === 1, `toujours 1 seule notification après confirmation du RDV (trouvé ${notifs38Apres})`);

  // ============================================================
  // TEST 39 - paiement en retard -> tâche COMPTABILITÉ ; rien si reçu.
  // ============================================================
  console.log("\n=== TEST 39 - paiement en retard -> tâche comptabilité ===");
  const mouvement39 = await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dossier1.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", statut: "A_RECEVOIR", datePrevue: new Date(Date.now() - 5 * 86_400_000), montantPrevuCts: 100_000 },
  });
  const rule39 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_PAIEMENT_RETARD", nom: "Test paiement retard", triggerType: "FINANCIAL_PAYMENT_LATE", triggerConfig: {}, actionType: "CREATE_TASK", actionConfig: { titre: "Paiement en retard", assigneRole: "COMPTABILITE", typeTache: "RELANCE_CLIENT" }, mode: "PREPARE_ONLY", actif: true },
  });
  await runAutomationRule(toRuleData(rule39), {});
  const taches39 = await prisma.tache.findMany({ where: { dossierId: dossier1.id, titre: "Paiement en retard" } });
  assert(taches39.length === 1, `1 tâche créée pour le paiement en retard (trouvé ${taches39.length})`);
  assert(taches39[0]?.assigneAId === compta.id, "la tâche est assignée au rôle COMPTABILITE");

  await prisma.mouvementFinancier.update({ where: { id: mouvement39.id }, data: { statut: "RECU", dateReelle: new Date() } });
  await runAutomationRule(toRuleData(rule39), {});
  const taches39Apres = await prisma.tache.findMany({ where: { dossierId: dossier1.id, titre: "Paiement en retard" } });
  assert(taches39Apres.length === 1, `aucune nouvelle tâche une fois le paiement reçu (trouvé ${taches39Apres.length})`);

  // ============================================================
  // TEST 40 - étude obsolète -> tâche de recalcul, idempotente.
  // ============================================================
  console.log("\n=== TEST 40 - étude obsolète -> tâche recalcul, idempotente ===");
  const client40 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "Etude", email: "client-etude-p11@example.com" } });
  const dossier40 = await prisma.dossier.create({ data: { reference: `TEST-P11-ETUDE-${Math.random().toString(36).slice(2, 8)}`, clientId: client40.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 500_000 } });
  await prisma.dossierPosteTravaux.create({ data: { dossierId: dossier40.id, type: "PAC_AIR_EAU", surfaceM2: 80 } });
  await prisma.etudeDossier.create({ data: { organisationId: org.id, dossierId: dossier40.id, version: 1, mode: "OFFICIEL", inputsSnapshot: {}, resultsSnapshot: {}, inputHash: "hash-volontairement-perime" } });

  const contextEtude40 = await buildStudyContext(dossier40.id, org.id);
  assert(isStudyStale({ inputHash: "hash-volontairement-perime" }, contextEtude40), "l'étude est bien détectée comme obsolète (hash différent)");

  const rule40 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_ETUDE_OBSOLETE", nom: "Test étude obsolète", triggerType: "STUDY_STALE", triggerConfig: {}, actionType: "CREATE_TASK", actionConfig: { titre: "Étude à recalculer", typeTache: "AUTRE" }, delayJours: 0, mode: "PREPARE_ONLY", actif: true },
  });
  await runAutomationRule(toRuleData(rule40), {});
  await runAutomationRule(toRuleData(rule40), {});
  const taches40 = await prisma.tache.findMany({ where: { dossierId: dossier40.id, titre: "Étude à recalculer" } });
  assert(taches40.length === 1, `1 seule tâche de recalcul même après 2 exécutions (trouvé ${taches40.length})`);

  // ============================================================
  // TEST 41 - accès sous-traitant : voit le package qui lui est destiné,
  // jamais celui d'un autre sous-traitant, ni l'avis fiscal/la marge/les
  // documents hors package.
  // ============================================================
  console.log("\n=== TEST 41 - scoping sous-traitant ===");
  const client41 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "SousTraitant" } });
  const dossier41 = await prisma.dossier.create({ data: { reference: `TEST-P11-ST-${Math.random().toString(36).slice(2, 8)}`, clientId: client41.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 800_000 } });
  const poste41 = await prisma.dossierPosteTravaux.create({ data: { dossierId: dossier41.id, type: "ITE", surfaceM2: 100, sousTraitantId: sousTraitantA.id, montantPoseSousTraitanceCts: 300_000, montantDevisTTCCts: 800_000, montantMaterielHTCts: 200_000 } });
  const typeDoc41 = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_TEST41", nom: "Pièce test 41" } });
  const doc41 = await prisma.dossierDocument.create({ data: { dossierId: dossier41.id, type: "AUTRE", nomFichier: "piece-package.pdf", cheminFichier: "test/piece-package.pdf", mimeType: "application/pdf", tailleOctets: 100, organisationId: org.id, typeDocumentId: typeDoc41.id, statut: "VALIDE", provenance: "COMMERCIAL" } });
  const packageA41 = await prisma.transmissionPackage.create({
    data: { organisationId: org.id, dossierId: dossier41.id, destinationType: "SOUS_TRAITANT", destinationSousTraitantId: sousTraitantA.id, status: "PRET", snapshot: {}, documents: { create: [{ dossierDocumentId: doc41.id, typeDocumentId: typeDoc41.id, version: 1, ordre: 0 }] } },
  });
  const packageB41 = await prisma.transmissionPackage.create({ data: { organisationId: org.id, dossierId: dossier41.id, destinationType: "SOUS_TRAITANT", destinationSousTraitantId: sousTraitantB.id, status: "PRET", snapshot: {} } });

  assert(canAccessPackageAsPartner(ctxSousTraitantA, packageA41), "le sous-traitant A accède au package qui lui est destiné");
  assert(!canAccessPackageAsPartner(ctxSousTraitantA, packageB41), "le sous-traitant A n'accède PAS au package destiné au sous-traitant B");

  const packagesA41 = await getPartnerPackages(ctxSousTraitantA);
  assert(packagesA41.some((p) => p.packageId === packageA41.id), "getPartnerPackages(A) inclut le package A");
  assert(!packagesA41.some((p) => p.packageId === packageB41.id), "getPartnerPackages(A) n'inclut PAS le package B");

  const dossiersA41 = await getPartnerDossiers(ctxSousTraitantA);
  const dossierVu41 = dossiersA41.find((d) => d.dossierId === dossier41.id);
  assert(dossierVu41 != null, "le sous-traitant A voit le dossier où il a un poste assigné");
  const posteVu41 = dossierVu41?.postes.find((p) => p.id === poste41.id);
  assert(posteVu41 != null && posteVu41.montantPoseSousTraitanceCts === 300_000, "le sous-traitant voit SON prix de pose");
  assert(posteVu41 != null && !("montantMaterielHTCts" in posteVu41) && !("montantDevisTTCCts" in posteVu41), "aucune donnée de coût matériel/devis client dans la vue partenaire (jamais la marge)");

  // ============================================================
  // TEST 42 - webhook noop en test : payload, signature HMAC, journal, et
  // retry borné à 3 tentatives max SANS appel réseau réel en test standard.
  // ============================================================
  console.log("\n=== TEST 42 - webhook (noop + signature + journal + retry borné) ===");
  assert(isWebhookSendEnabled() === false, "WEBHOOK_SEND_ENABLED est bien désactivé en environnement de test (aucun envoi réel)");

  const endpoint42 = await prisma.webhookEndpoint.create({ data: { organisationId: org.id, url: "https://example.invalid/hook", secret: "test-secret-p11", eventTypes: ["PACKAGE_READY"], actif: true } });
  await emitDomainEvent(org.id, "PACKAGE_READY", { packageId: packageA41.id, dossierId: dossier41.id });
  const deliveries42 = await prisma.webhookDelivery.findMany({ where: { endpointId: endpoint42.id } });
  assert(deliveries42.length === 1, `1 WebhookDelivery journalisée (trouvé ${deliveries42.length})`);
  assert(deliveries42[0].statut === "EN_ATTENTE" && deliveries42[0].attempts === 0, "aucun envoi réseau réel tenté (préparé, jamais émis)");

  const sig1 = signWebhookPayload("secret-a", '{"x":1}');
  const sig2 = signWebhookPayload("secret-b", '{"x":1}');
  assert(sig1 !== sig2 && sig1.length === 64, "la signature HMAC-SHA256 est stable et dépend bien du secret");

  // Retry borné : on force temporairement WEBHOOK_SEND_ENABLED sur une URL
  // localhost injoignable (aucun serveur réel contacté, juste une connexion
  // refusée en local) pour vérifier que le moteur abandonne après
  // exactement 3 tentatives, jamais une boucle infinie.
  const previousFlag = process.env.WEBHOOK_SEND_ENABLED;
  process.env.WEBHOOK_SEND_ENABLED = "true";
  const endpointRetry = await prisma.webhookEndpoint.create({ data: { organisationId: org.id, url: "http://127.0.0.1:1/injoignable", secret: "test-secret-p11", eventTypes: ["PACKAGE_READY"], actif: true } });
  const { deliverToEndpoint } = await import("../src/lib/webhooks/service");
  const retryResult = await deliverToEndpoint(endpointRetry.id, org.id, "PACKAGE_READY", { test: true });
  process.env.WEBHOOK_SEND_ENABLED = previousFlag;
  const deliveryRetry = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: retryResult.id } });
  assert(deliveryRetry.attempts === 3, `exactement 3 tentatives puis abandon (trouvé ${deliveryRetry.attempts})`);
  assert(deliveryRetry.statut === "ECHEC", "le statut final est ECHEC après épuisement des tentatives");
  assert(retryResult.sent === false, "aucun envoi réussi vers une URL injoignable");

  // ============================================================
  // TEST 43 - variables de template : variables autorisées rendues
  // correctement ; variable inconnue -> erreur contrôlée, jamais de code
  // exécuté.
  // ============================================================
  console.log("\n=== TEST 43 - variables de template whitelistées uniquement ===");
  assert(renderTemplate("Bonjour {{client.prenom}} !", { "client.prenom": "Jean" }) === "Bonjour Jean !", "une variable autorisée est correctement substituée");

  let leve43 = false;
  try {
    renderTemplate("Bonjour {{client.inconnu}}", {});
  } catch (e) {
    leve43 = e instanceof UnknownTemplateVariableError;
  }
  assert(leve43, "une variable inconnue lève une erreur contrôlée (UnknownTemplateVariableError)");

  let leveInjection43 = false;
  try {
    // Nom de variable qui ressemble à une tentative d'évasion - toujours
    // comparé littéralement à la whitelist, jamais interprété.
    renderTemplate("{{constructor}}", {});
  } catch (e) {
    leveInjection43 = e instanceof UnknownTemplateVariableError;
  }
  assert(leveInjection43, "une variable au nom \"suspect\" (constructor) est rejetée comme n'importe quelle variable inconnue - jamais un traitement spécial");

  // Une syntaxe qui ne correspond même pas au format {{variable}} attendu
  // (parenthèses/apostrophes) n'est tout simplement JAMAIS substituée ni
  // exécutée - elle traverse le renderer inchangée, jamais interprétée
  // comme du code.
  const rawInjectionAttempt = "{{constructor.constructor('return 1')()}}";
  assert(renderTemplate(rawInjectionAttempt, {}) === rawInjectionAttempt, "une syntaxe hors-format n'est ni substituée ni exécutée - traverse le renderer inchangée");

  const validation43 = validateTemplateVariables("{{dossier.reference}} {{hack.field}}");
  assert(!validation43.valid && validation43.unknownVariables.includes("hack.field"), "validateTemplateVariables détecte précisément la variable non whitelistée");

  // ============================================================
  // TEST 44 - multi-tenant : une automation de l'org A ne crée jamais rien
  // dans l'org B.
  // ============================================================
  console.log("\n=== TEST 44 - cloisonnement multi-tenant des automations ===");
  const orgB = await prisma.organisation.create({ data: { nom: "Test Automations P11 - Org B", slug: `test-automations-p11-b-${Date.now()}` } });
  const clientB44 = await prisma.client.create({ data: { organisationId: orgB.id, prenom: "Org", nom: "B" } });
  const dossierB44 = await prisma.dossier.create({ data: { reference: `TEST-P11-B-${Math.random().toString(36).slice(2, 8)}`, clientId: clientB44.id, organisationId: orgB.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 400_000 } });
  const typeDocB44 = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgB.id, code: "PIECE_TEST44B", nom: "Pièce test 44 org B" } });
  await prisma.documentRequirement.create({ data: { organisationId: orgB.id, typeDocumentId: typeDocB44.id, obligatoire: true, responsable: "CLIENT" } });

  // rule36 (org A) ne doit détecter QUE des entités de l'org A, jamais dossierB44.
  const summary44 = await runAutomationRule(toRuleData(rule36), {});
  assert(!summary44.executions.some((e) => e.entityId === dossierB44.id), "la règle de l'org A ne matche jamais une entité de l'org B");
  const executionsOrgA = await prisma.automationExecution.findMany({ where: { ruleId: rule36.id } });
  assert(executionsOrgA.every((e) => e.organisationId === org.id), "toutes les exécutions de la règle org A restent journalisées sous org A");

  const draftsOrgB44 = await prisma.emailDraft.findMany({ where: { organisationId: orgB.id } });
  assert(draftsOrgB44.length === 0, "aucun draft email n'a fuité vers l'org B");
  const notifsOrgB44 = await prisma.notification.findMany({ where: { organisationId: orgB.id } });
  assert(notifsOrgB44.length === 0, "aucune notification n'a fuité vers l'org B");

  // ============================================================
  // TEST 45 - permissions : commercial prépare ses propres dossiers, admin
  // gère templates/règles, sous-traitant n'a aucun accès aux automations
  // internes.
  // ============================================================
  console.log("\n=== TEST 45 - permissions automatisations/communications ===");
  assert(hasPermission(ctxCommercial, "PREPARE_COMMUNICATIONS"), "COMMERCIAL peut préparer des communications");
  assert(canAccessDossierCommunication(ctxCommercial, dossier1), "COMMERCIAL accède à la communication de SON dossier");
  const dossierDeB45 = await prisma.dossier.findFirstOrThrow({ where: { id: dossier41.id } });
  void dossierDeB45;
  const dossierAutreCommercial = await prisma.dossier.create({ data: { reference: `TEST-P11-AUTRE-${Math.random().toString(36).slice(2, 8)}`, clientId: client1.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 100_000, createdById: commercialB.id } });
  assert(!canAccessDossierCommunication(ctxCommercial, dossierAutreCommercial), "COMMERCIAL n'accède PAS à la communication du dossier d'un autre commercial");

  assert(hasPermission(ctxAdmin, "MANAGE_AUTOMATIONS"), "ADMIN gère les règles/templates");
  assert(!hasPermission(ctxCommercial, "MANAGE_AUTOMATIONS"), "COMMERCIAL ne gère PAS les règles/templates");

  assert(isPartnerRole(ctxSousTraitantA), "le compte sous-traitant est bien identifié comme partenaire");
  assert(!hasPermission(ctxSousTraitantA, "VIEW_AUTOMATIONS"), "le sous-traitant n'a AUCUN accès au dashboard automatisations");
  assert(!hasPermission(ctxSousTraitantA, "MANAGE_AUTOMATIONS"), "le sous-traitant ne gère PAS les automatisations");
  assert(!hasPermission(ctxSousTraitantA, "PREPARE_COMMUNICATIONS"), "le sous-traitant ne prépare PAS de communications internes");
  assert(!hasPermission(ctxSousTraitantA, "VIEW_NOTIFICATIONS"), "le sous-traitant n'a PAS accès aux notifications internes");

  // ============================================================
  // TEST 46 - dry run : retourne les actions prévues, aucune ligne réelle
  // créée (seulement un log explicitement DRY_RUN).
  // ============================================================
  console.log("\n=== TEST 46 - dry run : aucun effet réel ===");
  const client46 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "DryRun", email: "client-dryrun-p11@example.com" } });
  const dossier46 = await prisma.dossier.create({ data: { reference: `TEST-P11-DRYRUN-${Math.random().toString(36).slice(2, 8)}`, clientId: client46.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 300_000 } });
  const typeDoc46 = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_TEST46", nom: "Pièce test 46" } });
  await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeDoc46.id, obligatoire: true, responsable: "CLIENT" } });
  const rule46 = await prisma.automationRule.create({
    data: { organisationId: org.id, code: "TEST_DRYRUN", nom: "Test dry run", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 0 }, actionType: "PREPARE_DOCUMENT_REQUEST", actionConfig: {}, delayJours: 0, mode: "PREPARE_ONLY", actif: true },
  });

  const dryRunSummary1 = await runAutomationRule(toRuleData(rule46), { dryRun: true });
  assert(dryRunSummary1.matched >= 1 && dryRunSummary1.executions.every((e) => e.status === "DRY_RUN"), "le dry run retourne bien les actions prévues, marquées DRY_RUN");
  const draftsApresDryRun = await prisma.emailDraft.count({ where: { dossierId: dossier46.id } });
  assert(draftsApresDryRun === 0, "aucun brouillon réel n'est créé par le dry run");
  const executionsDryRun = await prisma.automationExecution.count({ where: { ruleId: rule46.id, entityId: dossier46.id, status: "DRY_RUN" } });
  assert(executionsDryRun >= 1, "un log explicitement DRY_RUN est bien journalisé");

  const dryRunSummary2 = await runAutomationRule(toRuleData(rule46), { dryRun: true });
  assert(dryRunSummary2.matched >= 1, "un second dry run reste possible (jamais bloqué par une fausse idempotence)");

  // Note : rule46 est une règle org-wide (comme toute AutomationRule) - elle
  // peut légitimement matcher D'AUTRES dossiers de test déjà MANQUANT dans
  // cette même organisation (ex. dossier1 du TEST 36). On vérifie donc
  // l'effet réel SPÉCIFIQUEMENT sur dossier46, pas le total de la règle.
  const realRunSummary = await runAutomationRule(toRuleData(rule46), {});
  const execution46Reelle = realRunSummary.executions.find((e) => e.entityId === dossier46.id);
  assert(execution46Reelle?.status === "SUCCESS", `l'exécution réelle (après les dry runs) produit bien un effet réel sur dossier46 (trouvé ${execution46Reelle?.status})`);
  const draftsApresReel = await prisma.emailDraft.count({ where: { dossierId: dossier46.id } });
  assert(draftsApresReel === 1, `exactement 1 brouillon réel créé après l'exécution réelle (trouvé ${draftsApresReel})`);

  // --- Nettoyage ---
  const allOrgIds = [org.id, orgB.id];
  await prisma.notification.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.webhookDelivery.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.automationExecution.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.automationRule.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.emailSendLog.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.emailDraft.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.transmissionPackageDocument.deleteMany({ where: { package: { organisationId: { in: allOrgIds } } } });
  await prisma.transmissionPackage.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.tache.deleteMany({ where: { dossier: { organisationId: { in: allOrgIds } } } });
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.rdv.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.etudeDossier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossierDocument.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.documentRequirement.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.typeDocumentReferentiel.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossier: { organisationId: { in: allOrgIds } } } });
  await prisma.dossier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.client.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.auditLog.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, administratif.id, commercial.id, commercialB.id, compta.id, userSousTraitantA.id] } } });
  await prisma.sousTraitant.deleteMany({ where: { id: { in: [sousTraitantA.id, sousTraitantB.id] } } });
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
