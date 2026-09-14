import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAutomationRuleById } from "../src/lib/automations/engine";
import { createMissionPackage } from "../src/lib/documents/mission";
import { missionLinkForPartner, demandeLinkForDonneurOrdre, dossierLinkForInternal, facturesLinkForDonneurOrdre } from "../src/lib/links";

// ============================================================
// P16 - tests bout-en-bout du moteur P11 étendu (mission ST, portail
// donneur d'ordre, RDV) : brouillon correct, lien correct, données
// filtrées, pas de doublon, relance stoppée après action réalisée,
// isolation tenant/partenaire. EMAIL_SEND_ENABLED reste false pendant ces
// tests (aucun envoi réel, uniquement des EmailDraft).
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
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

async function main() {
  const suffix = Date.now();
  const orgBHM = await prisma.organisation.create({ data: { nom: "Test P16 BHM", slug: `test-p16-bhm-${suffix}` } });
  const orgRUA = await prisma.organisation.create({ data: { nom: "Test P16 RUA", slug: `test-p16-rua-${suffix}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const statutAccepte = await prisma.dossierStatus.findFirst({ where: { key: "ACCEPTE" } });

  const clientBHM = await prisma.client.create({
    data: { organisationId: orgBHM.id, prenom: "Jean", nom: "Testeur", telephone: "0600000000", email: "jean.testeur@example.invalid", adresse: "1 rue du Test" },
  });

  const dossierBHM = await prisma.dossier.create({
    data: { reference: `TEST-P16-${suffix}`, clientId: clientBHM.id, organisationId: orgBHM.id, typeId: type.id, statutId: statut.id, montantDevisTTC: 100000 },
  });
  const poste = await prisma.dossierPosteTravaux.create({ data: { dossierId: dossierBHM.id, type: "ITE", surfaceM2: 142 } });

  const stA = await prisma.sousTraitant.create({ data: { organisationId: orgBHM.id, nom: "Test ST A" } });
  const stB = await prisma.sousTraitant.create({ data: { organisationId: orgBHM.id, nom: "Test ST B" } });
  const userStA = await prisma.user.create({ data: { name: "ST A User", email: `st-a-${suffix}@test.local`, password: "x", role: "SOUS_TRAITANT", organisationId: orgBHM.id, sousTraitantId: stA.id } });
  await prisma.user.create({ data: { name: "ST B User", email: `st-b-${suffix}@test.local`, password: "x", role: "SOUS_TRAITANT", organisationId: orgBHM.id, sousTraitantId: stB.id } });

  const doA = await prisma.donneurOrdre.create({ data: { organisationId: orgBHM.id, nom: "Test DO A" } });
  const doB = await prisma.donneurOrdre.create({ data: { organisationId: orgBHM.id, nom: "Test DO B" } });
  const userDoA = await prisma.user.create({ data: { name: "DO A User", email: `do-a-${suffix}@test.local`, password: "x", role: "DONNEUR_ORDRE", organisationId: orgBHM.id, donneurOrdreId: doA.id } });
  await prisma.user.create({ data: { name: "DO B User", email: `do-b-${suffix}@test.local`, password: "x", role: "DONNEUR_ORDRE", organisationId: orgBHM.id, donneurOrdreId: doB.id } });

  const admin = await prisma.user.create({ data: { name: "Admin Test", email: `admin-p16-${suffix}@test.local`, password: "x", role: "ADMIN", organisationId: orgBHM.id } });
  const commercial = await prisma.user.create({ data: { name: "Commercial Test", email: `commercial-p16-${suffix}@test.local`, password: "x", role: "COMMERCIAL", organisationId: orgBHM.id } });

  async function makeRule(organisationId: string, code: string, triggerType: string, actionConfig: Record<string, unknown>, triggerConfig: Record<string, unknown> = {}) {
    return prisma.automationRule.create({
      data: {
        organisationId,
        code: `${code}-${suffix}`,
        nom: code,
        triggerType: triggerType as never,
        triggerConfig: triggerConfig as never,
        actionType: "PREPARE_EMAIL" as never,
        actionConfig: actionConfig as never,
        mode: "PREPARE_ONLY",
        actif: true,
      },
    });
  }

  // --- 1. Mission ST créée : brouillon correct, lien correct, données filtrées, pas de doublon ---
  console.log("\n1. Mission ST créée");
  const missionId = await createMissionPackage({
    organisationId: orgBHM.id,
    dossierId: dossierBHM.id,
    posteTravauxId: poste.id,
    sousTraitantId: stA.id,
    regieId: null,
    champsPartages: { nom: true, prenom: true, adresse: true, telephone: false, email: false },
    documentIds: [],
    dateDebutSouhaitee: null,
    dateFinSouhaitee: null,
    instructions: "Attention accès chantier",
    prixConvenuCts: 500000,
    createdById: admin.id,
  });
  const ruleMissionCreee = await makeRule(orgBHM.id, "TEST_MISSION_ST_CREEE_J0", "MISSION_ST_CREEE", { templateCode: "MISSION_ST_NOUVELLE" }, { stepIndex: 0 });
  const run1 = await runAutomationRuleById(ruleMissionCreee.id, orgBHM.id);
  assert(run1.executed === 1, "1er passage : 1 exécution (brouillon créé)");
  const draft1 = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: userStA.email }, orderBy: { createdAt: "desc" } });
  assert(!!draft1, "Brouillon email créé pour le sous-traitant");
  assert(!!draft1?.corps.includes(missionLinkForPartner()), "Lien correct vers /partenaire dans le corps");
  assert(!!draft1?.corps.includes("Jean") && !!draft1?.corps.includes("Testeur"), "Nom/prénom (partagés) présents dans l'email");
  assert(!draft1?.corps.includes("jean.testeur@example.invalid"), "Email du client (NON partagé) absent de l'email envoyé au ST");

  const run2 = await runAutomationRuleById(ruleMissionCreee.id, orgBHM.id);
  assert(run2.executed === 0 && run2.skipped === 1, "2e passage : SKIPPED (idempotence, pas de doublon)");
  const countDrafts = await prisma.emailDraft.count({ where: { organisationId: orgBHM.id, destinataire: userStA.email } });
  assert(countDrafts === 1, "Un seul brouillon au total pour cette mission (pas de doublon)");

  // --- 4. Action réalisée -> relance stoppée ---
  console.log("\n2. Action réalisée -> relance stoppée");
  const ruleMissionJ3 = await makeRule(orgBHM.id, "TEST_MISSION_ST_CREEE_J3", "MISSION_ST_CREEE", { templateCode: "MISSION_ST_NOUVELLE" }, { stepIndex: 1 });
  const runJ3AvantAcceptation = await runAutomationRuleById(ruleMissionJ3.id, orgBHM.id, { now: daysFromNow(4) });
  assert(runJ3AvantAcceptation.executed === 1, "J+3 avant acceptation : relance envoyée");

  await prisma.transmissionPackage.update({ where: { id: missionId }, data: { status: "ACCEPTEE", respondedAt: new Date(), respondedById: userStA.id } });
  const ruleMissionJ7 = await makeRule(orgBHM.id, "TEST_MISSION_ST_CREEE_J7", "MISSION_ST_CREEE", { templateCode: "MISSION_ST_NOUVELLE" }, { stepIndex: 2 });
  const runJ7ApresAcceptation = await runAutomationRuleById(ruleMissionJ7.id, orgBHM.id, { now: daysFromNow(8) });
  assert(runJ7ApresAcceptation.matched === 0, "J+7 après acceptation : plus aucun match (relance stoppée automatiquement)");

  // --- 2. Complément DO : email correct, lien vers la demande ---
  console.log("\n3. Complément donneur d'ordre");
  const dossierDoA = await prisma.dossier.create({
    data: {
      reference: `TEST-P16-DOA-${suffix}`,
      clientId: clientBHM.id,
      organisationId: orgBHM.id,
      typeId: type.id,
      statutId: statut.id,
      montantDevisTTC: 50000,
      donneurOrdreId: doA.id,
      complementDemandeMessage: "Merci de préciser l'accès au chantier",
      complementDemandeAt: new Date(),
    },
  });
  const ruleComplement = await makeRule(orgBHM.id, "TEST_DO_COMPLEMENT_REQUIS_J0", "DO_COMPLEMENT_REQUIS", { templateCode: "DO_COMPLEMENT_REQUIS" }, { stepIndex: 0 });
  const runComplement = await runAutomationRuleById(ruleComplement.id, orgBHM.id);
  assert(runComplement.executed === 1, "Complément requis : brouillon créé");
  const draftComplement = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: userDoA.email } });
  assert(!!draftComplement, "Brouillon adressé au bon donneur d'ordre (DO A)");
  assert(!!draftComplement?.corps.includes(demandeLinkForDonneurOrdre(dossierDoA.id)), "Lien correct vers la demande DO");

  // --- 3. RDV -> email commercial ---
  console.log("\n4. RDV créé -> email commercial");
  const rdv = await prisma.rdv.create({ data: { organisationId: orgBHM.id, dossierId: dossierBHM.id, date: daysFromNow(1), type: "TELEPHONIQUE", commercialId: commercial.id } });
  const ruleRdv = await makeRule(orgBHM.id, "TEST_RDV_CREE", "RDV_CREE", { templateCode: "RDV_CREE" });
  const runRdv = await runAutomationRuleById(ruleRdv.id, orgBHM.id);
  assert(runRdv.executed === 1, "RDV créé : brouillon créé");
  const draftRdv = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: commercial.email } });
  assert(!!draftRdv, "Brouillon adressé au bon commercial");
  assert(!!draftRdv?.corps.includes(dossierLinkForInternal(dossierBHM.id)), "Lien correct vers le dossier");
  void rdv;

  // --- 6. Facture DO échue : relance J0/J+7, arrêt dès réglée ---
  console.log("\n6. Facture donneur d'ordre échue");
  const echeanceFacture = new Date();
  const factureEchue = await prisma.facture.create({
    data: {
      organisationId: orgBHM.id,
      dossierId: dossierDoA.id,
      type: "DONNEUR_ORDRE",
      numero: `FDO-TEST-${suffix}`,
      donneurOrdreId: doA.id,
      montantHTCts: 100000,
      tauxTVA: 0.2,
      montantTVACts: 20000,
      montantTTCCts: 120000,
      dateEcheance: echeanceFacture,
      statut: "EMISE",
    },
  });
  const mouvementFacture = await prisma.mouvementFinancier.create({
    data: {
      organisationId: orgBHM.id,
      dossierId: dossierDoA.id,
      type: "ENTREE",
      categorie: "ENCAISSEMENT_DONNEUR_ORDRE",
      montantPrevuCts: 120000,
      datePrevue: factureEchue.dateEcheance,
      statut: "A_RECEVOIR",
    },
  });
  await prisma.facture.update({ where: { id: factureEchue.id }, data: { mouvementFinancierId: mouvementFacture.id } });

  const ruleFactureEchueJ0 = await makeRule(orgBHM.id, "TEST_DO_FACTURE_ECHUE_J0", "DO_FACTURE_ECHUE", { templateCode: "FACTURE_ECHUE" }, { stepIndex: 0 });
  const runFactureEchueJ0 = await runAutomationRuleById(ruleFactureEchueJ0.id, orgBHM.id, { now: echeanceFacture });
  assert(runFactureEchueJ0.executed === 1, "Facture échue J0 : brouillon créé");
  const draftFactureEchue = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: userDoA.email, corps: { contains: factureEchue.numero } } });
  assert(!!draftFactureEchue, "Le brouillon mentionne bien le numéro de la facture échue");
  assert(!!draftFactureEchue?.corps.includes(facturesLinkForDonneurOrdre()), "Lien correct vers /portail-do/factures");

  const ruleFactureEchueJ7 = await makeRule(orgBHM.id, "TEST_DO_FACTURE_ECHUE_J7", "DO_FACTURE_ECHUE", { templateCode: "FACTURE_ECHUE" }, { stepIndex: 1 });
  const runFactureEchueJ7Trop = await runAutomationRuleById(ruleFactureEchueJ7.id, orgBHM.id, { now: new Date(echeanceFacture.getTime() + 4 * 86_400_000) });
  assert(runFactureEchueJ7Trop.matched === 0, "Facture échue J+7 : ne matche pas avant J+7 (fenêtre respectée)");
  const runFactureEchueJ7 = await runAutomationRuleById(ruleFactureEchueJ7.id, orgBHM.id, { now: new Date(echeanceFacture.getTime() + 8 * 86_400_000) });
  assert(runFactureEchueJ7.executed === 1, "Facture échue J+7 : relance envoyée");

  await prisma.mouvementFinancier.update({ where: { id: mouvementFacture.id }, data: { statut: "RECU", montantReelCts: 120000, dateReelle: new Date() } });
  const ruleFactureEchueJ15 = await makeRule(orgBHM.id, "TEST_DO_FACTURE_ECHUE_J15", "DO_FACTURE_ECHUE", { templateCode: "FACTURE_ECHUE" }, { stepIndex: 2 });
  const runFactureEchueJ15 = await runAutomationRuleById(ruleFactureEchueJ15.id, orgBHM.id, { now: new Date(echeanceFacture.getTime() + 16 * 86_400_000) });
  assert(runFactureEchueJ15.matched === 0, "Facture réglée entre-temps : J+15 ne matche plus (arrêt automatique)");

  // --- 5. Isolation BHM != RUA, ST A != ST B, DO A != DO B ---
  console.log("\n5. Isolation tenant / partenaire");
  const ruleMissionCreeeRUA = await makeRule(orgRUA.id, "TEST_MISSION_ST_CREEE_RUA", "MISSION_ST_CREEE", { templateCode: "MISSION_ST_NOUVELLE" }, { stepIndex: 0 });
  const runRUA = await runAutomationRuleById(ruleMissionCreeeRUA.id, orgRUA.id);
  assert(runRUA.matched === 0, "BHM != RUA : la mission BHM n'est jamais vue par une règle scopée RUA");

  const draftForStB = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: userStA.email, corps: { contains: "Test ST B" } } });
  assert(!draftForStB, "ST A != ST B : aucun email destiné à ST A ne mentionne ST B");

  const draftDoAWithDoBName = await prisma.emailDraft.findFirst({ where: { organisationId: orgBHM.id, destinataire: userDoA.email, corps: { contains: "Test DO B" } } });
  assert(!draftDoAWithDoBName, "DO A != DO B : aucun email destiné à DO A ne mentionne DO B");

  // --- Nettoyage ---
  await prisma.emailDraft.deleteMany({ where: { organisationId: { in: [orgBHM.id, orgRUA.id] } } });
  await prisma.automationExecution.deleteMany({ where: { organisationId: { in: [orgBHM.id, orgRUA.id] } } });
  await prisma.automationRule.deleteMany({ where: { organisationId: { in: [orgBHM.id, orgRUA.id] } } });
  await prisma.rdv.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.facture.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.transmissionPackage.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossierId: { in: [dossierBHM.id, dossierDoA.id] } } });
  await prisma.dossier.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.user.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.sousTraitant.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.donneurOrdre.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.client.deleteMany({ where: { organisationId: orgBHM.id } });
  await prisma.organisation.deleteMany({ where: { id: { in: [orgBHM.id, orgRUA.id] } } });

  void statutAccepte;
  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
