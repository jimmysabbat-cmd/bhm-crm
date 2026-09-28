import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAutomationRuleById } from "../src/lib/automations/engine";
import { detectCeePaiementRetard, detectMissionRegieAPlanifier, detectFactureAPayer, detectDoAFacturer, detectMissionStFactureAttendue } from "../src/lib/automations/triggers";
import { activerEmailsAutomatiques } from "../src/lib/automations/activation";
import { chiffrerSecret, dechiffrerSecret } from "../src/lib/email/org-smtp";
import { sendEmailDraft, createEmailDraft } from "../src/lib/email/service";
import { getPilotagePoses } from "../src/lib/poses/pilotage";
import { getSuiviDelegataires, getFacturesAPayer } from "../src/lib/tresorerie";
import { seedAutomations } from "../prisma/seed-automations";

// ============================================================
// Pilotage poses / délégataires CEE / factures à payer / emails par société.
// Aucun envoi réel : aucune société de test n'a de SMTP configuré.
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
const jours = (n: number) => new Date(Date.now() + n * 86_400_000);

async function main() {
  const suffix = Date.now();
  const org = await prisma.organisation.create({ data: { nom: "Test Pilotage", slug: `test-pilotage-${suffix}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = (key: string) => prisma.dossierStatus.findUniqueOrThrow({ where: { key } });
  const [sTermines, sAccepte] = await Promise.all([statut("TRAVAUX_TERMINES"), statut("ACCEPTE")]);
  const client = await prisma.client.create({ data: { organisationId: org.id, prenom: "Paul", nom: "Test" } });
  const rule = { organisationId: org.id, triggerConfig: {}, delayJours: 0, delayMinutes: null };

  // --- 1. Chiffrement SMTP ---
  console.log("\n1. Mot de passe SMTP chiffré");
  const chiffre = chiffrerSecret("MotDePasse-Test!");
  assert(!chiffre.includes("MotDePasse"), "le mot de passe n'apparaît pas en clair");
  assert(dechiffrerSecret(chiffre) === "MotDePasse-Test!", "déchiffrement exact");

  // --- 2. Délégataire en retard ---
  console.log("\n2. Relance délégataire CEE");
  const deleg = await prisma.delegataireCee.create({ data: { organisationId: org.id, nom: "Deleg Test", delaiPaiementJours: 30, contactEmail: "compta@deleg.invalid" } });
  const mk = (ref: string, data: Record<string, unknown>) =>
    prisma.dossier.create({ data: { reference: `${ref}-${suffix}`, clientId: client.id, organisationId: org.id, typeId: type.id, statutId: sTermines.id, montantDevisTTC: 1000000, ...data } as never });
  // Dépôt il y a 35 j, délai 30 j : échue depuis 5 j => fenêtre de relance J0.
  const dRetard = await mk("RETARD", { delegataireCeeId: deleg.id, montantAideCEE: 300000, dateDepotDelegataireCee: jours(-35) });
  const dPaye = await mk("PAYE", { delegataireCeeId: deleg.id, montantAideCEE: 300000, montantEncaisseCEE: 300000, dateDepotDelegataireCee: jours(-40) });
  const dPasEchu = await mk("PASECHU", { delegataireCeeId: deleg.id, montantAideCEE: 300000, dateDepotDelegataireCee: jours(-10) });
  const dADeposer = await mk("ADEPOSER", { delegataireCeeId: deleg.id, montantAideCEE: 200000, dateFinTravaux: jours(-5) });

  const m = await detectCeePaiementRetard(rule, new Date());
  const ids = m.map((x) => x.entityId);
  assert(ids.includes(dRetard.id), "prime échue non payée : relance");
  assert(!ids.includes(dPaye.id), "prime déjà encaissée : pas de relance");
  assert(!ids.includes(dPasEchu.id), "prime pas encore échue : pas de relance");
  assert(m.find((x) => x.entityId === dRetard.id)?.context.destinataireEmail === "compta@deleg.invalid", "email = contact du délégataire");
  await prisma.delegataireCee.update({ where: { id: deleg.id }, data: { emailsAuto: false } });
  const m2 = await detectCeePaiementRetard(rule, new Date());
  const mJ7 = await detectCeePaiementRetard({ ...rule, triggerConfig: { stepIndex: 1 } }, new Date());
  assert(!mJ7.some((x) => x.entityId === dRetard.id), "retard de 5 j : la relance J+7 n'est pas encore due");
  assert(m2.find((x) => x.entityId === dRetard.id)?.context.destinataireEmail === null, "emails coupés pour ce délégataire : pas de destinataire");
  await prisma.delegataireCee.update({ where: { id: deleg.id }, data: { emailsAuto: true } });

  const suivi = await getSuiviDelegataires(org.id);
  const s = suivi.find((x) => x.delegataireId === deleg.id)!;
  assert(s.enRetardCts === 300000, "suivi délégataire : 3 000 € en retard");
  assert(s.aDeposerCts === 200000, "suivi délégataire : 2 000 € à déposer");
  assert(s.primeAttendueCts === 800000, "suivi délégataire : 8 000 € attendus au total");
  void dADeposer;

  // --- 3. Emails par société : interrupteur + ligne de base ---
  console.log("\n3. Interrupteur société et ligne de base");
  await seedAutomations(prisma as never, org.id);
  const regleCee = await prisma.automationRule.findFirstOrThrow({ where: { organisationId: org.id, code: "CEE_RETARD_J0" } });
  assert(regleCee.mode === "AUTO" && regleCee.actionType === "SEND_EMAIL", "règle relance CEE créée en envoi automatique");
  const run1 = await runAutomationRuleById(regleCee.id, org.id);
  const draft = await prisma.emailDraft.findFirst({ where: { organisationId: org.id, dossierId: dRetard.id } });
  assert(run1.executed === 1 && draft?.statut === "BROUILLON", "société non activée : email préparé, jamais envoyé");
  const corps = (draft?.corps ?? "").replace(/[\u202f\u00a0]/g, " ");
  assert(corps.includes("3 000,00") && corps.includes(dRetard.reference), "le brouillon contient le montant et le dossier");

  const doTest = await prisma.donneurOrdre.create({ data: { organisationId: org.id, nom: "DO Test", contactEmail: "do@partenaire.invalid" } });
  const dDoAncien = await mk("DOANCIEN", { donneurOrdreId: doTest.id, statutId: sAccepte.id });
  const activation = await activerEmailsAutomatiques(org.id);
  assert(activation.evenementsPassesIgnores >= 1, "activation : les événements passés sont ignorés (pas d'envoi de l'historique)");
  const regleAccepte = await prisma.automationRule.findFirstOrThrow({ where: { organisationId: org.id, code: "DO_CHANTIER_ACCEPTE_EMAIL" } });
  assert(regleAccepte.mode === "AUTO" && regleAccepte.actionType === "SEND_EMAIL", "activation : règles partenaires passées en envoi automatique");
  const run2 = await runAutomationRuleById(regleAccepte.id, org.id);
  assert(run2.executed === 0 && !(await prisma.emailDraft.findFirst({ where: { dossierId: dDoAncien.id } })), "chantier accepté AVANT l'activation : aucun email");

  // Sans SMTP, un envoi n'est plus jamais marqué ENVOYE à tort.
  const draftId = await createEmailDraft({ organisationId: org.id, destinataire: "x@test.invalid", sujet: "s", corps: "c" });
  const envoi = await sendEmailDraft(draftId, org.id, null);
  const apres = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
  assert(!envoi.ok && apres.statut === "BROUILLON", "aucun SMTP : envoi en échec explicite, brouillon conservé");

  // --- 4. Poses : régie à planifier, DO à facturer, facture ST attendue ---
  console.log("\n4. Pilotage des poses");
  const regie = await prisma.regie.create({ data: { organisationId: org.id, nom: "Équipe Test" } });
  const st = await prisma.sousTraitant.create({ data: { organisationId: org.id, nom: "ST Test", email: "st@test.invalid", delaiPaiementJours: 30 } });
  const dPose = await mk("POSE", { donneurOrdreId: doTest.id, statutId: sAccepte.id });
  const posteRegie = await prisma.dossierPosteTravaux.create({ data: { dossierId: dPose.id, type: "COMBLES", surfaceM2: 80, prixPoseProposeHTCts: 160000, epaisseurMm: 300 } });
  const missionRegie = await prisma.transmissionPackage.create({
    data: { organisationId: org.id, dossierId: dPose.id, destinationType: "REGIE", destinationRegieId: regie.id, posteTravauxId: posteRegie.id, status: "ENVOYEE", snapshot: {} } as never,
  });
  const aPlanifier = await detectMissionRegieAPlanifier(rule, new Date());
  assert(aPlanifier.some((x) => x.entityId === missionRegie.id), "pose régie sans date : à planifier");
  let poses = await getPilotagePoses(org.id);
  assert(poses.find((p) => p.posteId === posteRegie.id)?.etape === "A_PLANIFIER", "tableau des poses : étape « à planifier »");

  await prisma.transmissionPackage.update({ where: { id: missionRegie.id }, data: { status: "TERMINEE", dateDebutSouhaitee: jours(-3) } });
  await prisma.dossier.update({ where: { id: dPose.id }, data: { statutId: sTermines.id, dateFinTravaux: jours(-2) } });
  poses = await getPilotagePoses(org.id);
  assert(poses.find((p) => p.posteId === posteRegie.id)?.etape === "A_FACTURER", "pose DO terminée : « à facturer au donneur d'ordre »");
  const aFacturer = await detectDoAFacturer({ ...rule, delayJours: 1 }, new Date());
  assert(aFacturer.some((x) => x.entityId === dPose.id), "trigger « DO à facturer » détecté");

  const posteSt = await prisma.dossierPosteTravaux.create({ data: { dossierId: dPose.id, type: "ITE", surfaceM2: 50 } });
  const missionSt = await prisma.transmissionPackage.create({
    data: { organisationId: org.id, dossierId: dPose.id, destinationType: "SOUS_TRAITANT", destinationSousTraitantId: st.id, posteTravauxId: posteSt.id, status: "TERMINEE", snapshot: {} } as never,
  });
  await prisma.transmissionPackage.update({ where: { id: missionSt.id }, data: { updatedAt: jours(-4) } });
  const factAttendue = await detectMissionStFactureAttendue(rule, new Date());
  assert(factAttendue.find((x) => x.entityId === missionSt.id)?.context.destinataireEmail === "st@test.invalid", "facture ST attendue : relance à l'email de la fiche (sans compte portail)");

  // --- 5. Factures à payer ---
  console.log("\n5. Factures à payer");
  const facture = await prisma.facture.create({
    data: { organisationId: org.id, dossierId: dPose.id, type: "SOUS_TRAITANT", numero: `F-${suffix}`, sousTraitantId: st.id, montantHTCts: 100000, tauxTVA: 0.2, montantTVACts: 20000, montantTTCCts: 120000, statut: "A_PAYER", dateEcheance: jours(2) },
  });
  const aPayer = await detectFactureAPayer({ ...rule, triggerConfig: { withinDays: 3 } }, new Date());
  assert(aPayer.find((x) => x.entityId === facture.id)?.triggerKey === "bientot", "facture à échéance sous 3 j : alerte « bientôt »");
  const liste = await getFacturesAPayer(org.id);
  assert(liste.find((f) => f.id === facture.id)?.resteCts === 120000, "liste factures à payer : reste 1 200 €");
  const factAttendue2 = await detectMissionStFactureAttendue(rule, new Date());
  assert(!factAttendue2.some((x) => x.entityId === missionSt.id), "facture déposée : la relance du sous-traitant s'arrête");

  // --- Nettoyage ---
  await prisma.automationExecution.deleteMany({ where: { organisationId: org.id } });
  await prisma.automationRule.deleteMany({ where: { organisationId: org.id } });
  await prisma.emailDraft.deleteMany({ where: { organisationId: org.id } });
  await prisma.emailSendLog.deleteMany({ where: { organisationId: org.id } });
  await prisma.tache.deleteMany({ where: { dossier: { organisationId: org.id } } });
  await prisma.notification.deleteMany({ where: { organisationId: org.id } });
  await prisma.facture.deleteMany({ where: { organisationId: org.id } });
  await prisma.transmissionPackage.deleteMany({ where: { organisationId: org.id } });
  await prisma.dossier.deleteMany({ where: { organisationId: org.id } });
  await prisma.client.deleteMany({ where: { organisationId: org.id } });
  await prisma.sousTraitant.deleteMany({ where: { organisationId: org.id } });
  await prisma.regie.deleteMany({ where: { organisationId: org.id } });
  await prisma.donneurOrdre.deleteMany({ where: { organisationId: org.id } });
  await prisma.delegataireCee.deleteMany({ where: { organisationId: org.id } });
  await prisma.auditLog.deleteMany({ where: { organisationId: org.id } }).catch(() => undefined);
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
