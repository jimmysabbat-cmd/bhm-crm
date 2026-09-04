import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createOrganisation, setOrganisationStatus, getPlatformOrganisations } from "../src/lib/platform/organisations";
import { createInvitation, checkInvitation, acceptInvitation, createPasswordResetToken, resetPasswordWithToken, checkResetToken } from "../src/lib/invitations/service";
import { validateEnv } from "../src/lib/env";
import { hasPermission, canAccessPackageAsPartner, isPartnerRole, type UserContext } from "../src/lib/authz";

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
  // TEST A - createOrganisation / statut / plateforme.
  // ============================================================
  console.log("\n=== TEST A - création organisation, statuts, slugs uniques ===");
  const orgAId = await createOrganisation({ nom: "Test P12 Tenant A" });
  const orgBId = await createOrganisation({ nom: "Test P12 Tenant B" });
  const orgADup = await createOrganisation({ nom: "Test P12 Tenant A" }); // même nom -> slug distinct
  const orgA = await prisma.organisation.findUniqueOrThrow({ where: { id: orgAId } });
  const orgADupRow = await prisma.organisation.findUniqueOrThrow({ where: { id: orgADup } });
  assert(orgA.status === "ACTIVE", "une organisation créée démarre ACTIVE");
  assert(orgA.slug !== orgADupRow.slug, `deux organisations de même nom obtiennent des slugs distincts (${orgA.slug} vs ${orgADupRow.slug})`);

  await setOrganisationStatus(orgAId, "SUSPENDED");
  const orgASuspended = await prisma.organisation.findUniqueOrThrow({ where: { id: orgAId } });
  assert(orgASuspended.status === "SUSPENDED", "setOrganisationStatus applique bien SUSPENDED");
  await setOrganisationStatus(orgAId, "ACTIVE");

  const platformList = await getPlatformOrganisations();
  assert(platformList.some((o) => o.id === orgAId) && platformList.some((o) => o.id === orgBId), "getPlatformOrganisations liste bien les organisations créées, avec compteurs");

  // ============================================================
  // TEST B - isolation multi-tenant sur un large éventail d'entités
  // (section 13) : ORG_A ne doit jamais lire une ligne d'ORG_B via une
  // requête scopée par organisationId.
  // ============================================================
  console.log("\n=== TEST B - isolation cross-tenant (large éventail d'entités) ===");
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatus = await prisma.dossierStatus.findFirstOrThrow();

  const adminA = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p12-adminA-${Date.now()}@example.com`, name: "Admin A", role: "ADMIN", actif: true, password: "x" } });
  const adminB = await prisma.user.create({ data: { organisationId: orgBId, email: `test-p12-adminB-${Date.now()}@example.com`, name: "Admin B", role: "ADMIN", actif: true, password: "x" } });

  const clientA = await prisma.client.create({ data: { organisationId: orgAId, prenom: "Client", nom: "A" } });
  const clientB = await prisma.client.create({ data: { organisationId: orgBId, prenom: "Client", nom: "B" } });
  const dossierA = await prisma.dossier.create({ data: { reference: `TEST-P12-A-${Math.random().toString(36).slice(2, 8)}`, clientId: clientA.id, organisationId: orgAId, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 100_000, createdById: adminA.id } });
  const dossierB = await prisma.dossier.create({ data: { reference: `TEST-P12-B-${Math.random().toString(36).slice(2, 8)}`, clientId: clientB.id, organisationId: orgBId, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 100_000, createdById: adminB.id } });

  const leadStatut = await prisma.leadPipelineStatus.findFirstOrThrow();
  const leadA = await prisma.lead.create({ data: { organisationId: orgAId, prenom: "Lead", nom: "A", statutId: leadStatut.id } });
  const leadB = await prisma.lead.create({ data: { organisationId: orgBId, prenom: "Lead", nom: "B", statutId: leadStatut.id } });

  const typeDocA = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgAId, code: "PIECE_P12_A", nom: "Pièce A" } });
  const docA = await prisma.dossierDocument.create({ data: { dossierId: dossierA.id, type: "AUTRE", nomFichier: "a.pdf", cheminFichier: "test/a.pdf", mimeType: "application/pdf", tailleOctets: 10, organisationId: orgAId, typeDocumentId: typeDocA.id, statut: "VALIDE", provenance: "COMMERCIAL" } });
  const typeDocB = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgBId, code: "PIECE_P12_B", nom: "Pièce B" } });
  const docB = await prisma.dossierDocument.create({ data: { dossierId: dossierB.id, type: "AUTRE", nomFichier: "b.pdf", cheminFichier: "test/b.pdf", mimeType: "application/pdf", tailleOctets: 10, organisationId: orgBId, typeDocumentId: typeDocB.id, statut: "VALIDE", provenance: "COMMERCIAL" } });

  const packageA = await prisma.transmissionPackage.create({ data: { organisationId: orgAId, dossierId: dossierA.id, destinationType: "ANAH", status: "BROUILLON", snapshot: {} } });
  const packageB = await prisma.transmissionPackage.create({ data: { organisationId: orgBId, dossierId: dossierB.id, destinationType: "ANAH", status: "BROUILLON", snapshot: {} } });

  const tacheA = await prisma.tache.create({ data: { dossierId: dossierA.id, type: "AUTRE", titre: "Tâche A", dateEcheance: new Date() } });
  const tacheB = await prisma.tache.create({ data: { dossierId: dossierB.id, type: "AUTRE", titre: "Tâche B", dateEcheance: new Date() } });

  const mouvementA = await prisma.mouvementFinancier.create({ data: { organisationId: orgAId, dossierId: dossierA.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", statut: "PREVU" } });
  const mouvementB = await prisma.mouvementFinancier.create({ data: { organisationId: orgBId, dossierId: dossierB.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", statut: "PREVU" } });

  const etudeA = await prisma.etudeDossier.create({ data: { organisationId: orgAId, dossierId: dossierA.id, version: 1, mode: "SIMULATION", inputsSnapshot: {}, resultsSnapshot: {}, inputHash: "hash-a" } });
  const etudeB = await prisma.etudeDossier.create({ data: { organisationId: orgBId, dossierId: dossierB.id, version: 1, mode: "SIMULATION", inputsSnapshot: {}, resultsSnapshot: {}, inputHash: "hash-b" } });

  const ruleA = await prisma.automationRule.create({ data: { organisationId: orgAId, code: "TEST_P12_A", nom: "Règle A", triggerType: "MANUAL_TRIGGER", actionType: "MARK_FLAG", mode: "MANUAL" } });
  const ruleB = await prisma.automationRule.create({ data: { organisationId: orgBId, code: "TEST_P12_B", nom: "Règle B", triggerType: "MANUAL_TRIGGER", actionType: "MARK_FLAG", mode: "MANUAL" } });

  const notifA = await prisma.notification.create({ data: { organisationId: orgAId, userId: adminA.id, type: "TEST", title: "A", message: "A" } });
  const notifB = await prisma.notification.create({ data: { organisationId: orgBId, userId: adminB.id, type: "TEST", title: "B", message: "B" } });

  const sousTraitantA = await prisma.sousTraitant.create({ data: { organisationId: orgAId, nom: "ST A" } });
  const sousTraitantB = await prisma.sousTraitant.create({ data: { organisationId: orgBId, nom: "ST B" } });
  const marA = await prisma.mar.create({ data: { organisationId: orgAId, nom: "MAR A" } });
  const marB = await prisma.mar.create({ data: { organisationId: orgBId, nom: "MAR B" } });
  const delegataireA = await prisma.delegataireCee.create({ data: { organisationId: orgAId, nom: "Délégataire A" } });
  const delegataireB = await prisma.delegataireCee.create({ data: { organisationId: orgBId, nom: "Délégataire B" } });

  type Check = { label: string; ownRow: () => Promise<unknown>; otherRow: () => Promise<unknown> };
  const checks: Check[] = [
    { label: "Client", ownRow: () => prisma.client.findFirst({ where: { id: clientA.id, organisationId: orgAId } }), otherRow: () => prisma.client.findFirst({ where: { id: clientB.id, organisationId: orgAId } }) },
    { label: "Lead", ownRow: () => prisma.lead.findFirst({ where: { id: leadA.id, organisationId: orgAId } }), otherRow: () => prisma.lead.findFirst({ where: { id: leadB.id, organisationId: orgAId } }) },
    { label: "Dossier", ownRow: () => prisma.dossier.findFirst({ where: { id: dossierA.id, organisationId: orgAId } }), otherRow: () => prisma.dossier.findFirst({ where: { id: dossierB.id, organisationId: orgAId } }) },
    { label: "DossierDocument", ownRow: () => prisma.dossierDocument.findFirst({ where: { id: docA.id, organisationId: orgAId } }), otherRow: () => prisma.dossierDocument.findFirst({ where: { id: docB.id, organisationId: orgAId } }) },
    { label: "TransmissionPackage", ownRow: () => prisma.transmissionPackage.findFirst({ where: { id: packageA.id, organisationId: orgAId } }), otherRow: () => prisma.transmissionPackage.findFirst({ where: { id: packageB.id, organisationId: orgAId } }) },
    { label: "Tache (via dossier)", ownRow: () => prisma.tache.findFirst({ where: { id: tacheA.id, dossier: { organisationId: orgAId } } }), otherRow: () => prisma.tache.findFirst({ where: { id: tacheB.id, dossier: { organisationId: orgAId } } }) },
    { label: "MouvementFinancier", ownRow: () => prisma.mouvementFinancier.findFirst({ where: { id: mouvementA.id, organisationId: orgAId } }), otherRow: () => prisma.mouvementFinancier.findFirst({ where: { id: mouvementB.id, organisationId: orgAId } }) },
    { label: "EtudeDossier", ownRow: () => prisma.etudeDossier.findFirst({ where: { id: etudeA.id, organisationId: orgAId } }), otherRow: () => prisma.etudeDossier.findFirst({ where: { id: etudeB.id, organisationId: orgAId } }) },
    { label: "AutomationRule", ownRow: () => prisma.automationRule.findFirst({ where: { id: ruleA.id, organisationId: orgAId } }), otherRow: () => prisma.automationRule.findFirst({ where: { id: ruleB.id, organisationId: orgAId } }) },
    { label: "Notification", ownRow: () => prisma.notification.findFirst({ where: { id: notifA.id, organisationId: orgAId } }), otherRow: () => prisma.notification.findFirst({ where: { id: notifB.id, organisationId: orgAId } }) },
    { label: "User", ownRow: () => prisma.user.findFirst({ where: { id: adminA.id, organisationId: orgAId } }), otherRow: () => prisma.user.findFirst({ where: { id: adminB.id, organisationId: orgAId } }) },
    { label: "SousTraitant", ownRow: () => prisma.sousTraitant.findFirst({ where: { id: sousTraitantA.id, organisationId: orgAId } }), otherRow: () => prisma.sousTraitant.findFirst({ where: { id: sousTraitantB.id, organisationId: orgAId } }) },
    { label: "Mar", ownRow: () => prisma.mar.findFirst({ where: { id: marA.id, organisationId: orgAId } }), otherRow: () => prisma.mar.findFirst({ where: { id: marB.id, organisationId: orgAId } }) },
    { label: "DelegataireCee", ownRow: () => prisma.delegataireCee.findFirst({ where: { id: delegataireA.id, organisationId: orgAId } }), otherRow: () => prisma.delegataireCee.findFirst({ where: { id: delegataireB.id, organisationId: orgAId } }) },
  ];

  for (const check of checks) {
    const own = await check.ownRow();
    const other = await check.otherRow();
    assert(own != null, `${check.label} : org A retrouve bien SA PROPRE ligne`);
    assert(other == null, `${check.label} : org A ne retrouve JAMAIS la ligne d'org B`);
  }

  // ============================================================
  // TEST C - permissions/partenaires (fonctions pures authz.ts).
  // ============================================================
  console.log("\n=== TEST C - permissions plateforme (fonctions pures) ===");
  const ctxAdminA: UserContext = { userId: adminA.id, organisationId: orgAId, role: "ADMIN" };
  const ctxSousTraitant: UserContext = { userId: adminA.id, organisationId: orgAId, role: "SOUS_TRAITANT", sousTraitantId: sousTraitantA.id };
  assert(hasPermission(ctxAdminA, "MANAGE_AUTOMATIONS"), "ADMIN a MANAGE_AUTOMATIONS");
  assert(isPartnerRole(ctxSousTraitant), "un SOUS_TRAITANT est bien identifié comme partenaire");
  assert(!canAccessPackageAsPartner(ctxSousTraitant, { destinationSousTraitantId: "autre-id", destinationDelegataireCeeId: null }), "un partenaire n'accède pas à un package destiné à un AUTRE sous-traitant");

  // ============================================================
  // TEST D - cycle de vie invitation (section 28/55) : usage unique,
  // expiration, aucune fuite d'existence de compte.
  // ============================================================
  console.log("\n=== TEST D - invitation : usage unique + expiration ===");
  const inviteEmail = `test-p12-invite-${Date.now()}@example.com`;
  const inviteToken = await createInvitation({ organisationId: orgAId, email: inviteEmail, role: "COMMERCIAL", invitedById: adminA.id });
  const check1 = await checkInvitation(inviteToken);
  assert(check1.valid && check1.email === inviteEmail && check1.role === "COMMERCIAL", "checkInvitation renvoie les bonnes infos avant usage");

  const accept1 = await acceptInvitation(inviteToken, "Invité Test", "MotDePasse123!");
  assert(accept1.ok, "acceptInvitation réussit la première fois");
  const createdInvitee = await prisma.user.findUnique({ where: { email: inviteEmail } });
  assert(createdInvitee != null && createdInvitee.organisationId === orgAId && createdInvitee.role === "COMMERCIAL", "le compte créé appartient au bon tenant avec le bon rôle");

  const accept2 = await acceptInvitation(inviteToken, "Rejoueur", "AutreMotDePasse123!");
  assert(!accept2.ok, "un second usage du MÊME token d'invitation est refusé (usage unique)");

  const expiredToken = await createInvitation({ organisationId: orgAId, email: `test-p12-expired-${Date.now()}@example.com`, role: "COMMERCIAL", invitedById: adminA.id });
  await prisma.userInvitation.update({ where: { tokenHash: crypto.createHash("sha256").update(expiredToken).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expiredCheck = await checkInvitation(expiredToken);
  assert(!expiredCheck.valid && expiredCheck.reason === "EXPIRED", "une invitation expirée est bien refusée avec la raison EXPIRED");

  const bogusCheck = await checkInvitation("token-qui-nexiste-pas");
  assert(!bogusCheck.valid && bogusCheck.reason === "NOT_FOUND", "un token inconnu est refusé sans fuite d'information");

  // ============================================================
  // TEST E - réinitialisation de mot de passe (section 28/56) : même
  // garanties (usage unique, expiration).
  // ============================================================
  console.log("\n=== TEST E - réinitialisation mot de passe : usage unique + expiration ===");
  const resetToken = await createPasswordResetToken(adminA.id);
  assert(await checkResetToken(resetToken), "un token de reset fraîchement créé est valide");
  const reset1 = await resetPasswordWithToken(resetToken, "NouveauMotDePasse123!");
  assert(reset1.ok, "resetPasswordWithToken réussit la première fois");
  const reset2 = await resetPasswordWithToken(resetToken, "EncoreUnAutre123!");
  assert(!reset2.ok, "un second usage du MÊME token de reset est refusé (usage unique)");

  const expiredResetToken = await createPasswordResetToken(adminA.id);
  await prisma.passwordResetToken.update({ where: { tokenHash: crypto.createHash("sha256").update(expiredResetToken).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert(!(await checkResetToken(expiredResetToken)), "un token de reset expiré est refusé");

  // ============================================================
  // TEST F - validation d'environnement (section 3/50) : critique en
  // production, tolérant en développement.
  // ============================================================
  console.log("\n=== TEST F - validation d'environnement production vs développement ===");
  const prevAppUrl = process.env.APP_URL;
  const prevAuthSecret = process.env.AUTH_SECRET;
  const prevNextAuthSecret = process.env.NEXTAUTH_SECRET;
  delete process.env.APP_URL;
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  const prodIssues = validateEnv("production");
  assert(prodIssues.some((i) => i.severity === "CRITICAL" && i.variable === "AUTH_SECRET"), "en production, AUTH_SECRET absent est détecté CRITICAL");
  const devIssuesNoAuth = validateEnv("development");
  assert(devIssuesNoAuth.some((i) => i.severity === "CRITICAL"), "AUTH_SECRET absent reste critique même en développement (sessions non sécurisables)");
  if (prevAppUrl) process.env.APP_URL = prevAppUrl;
  if (prevAuthSecret) process.env.AUTH_SECRET = prevAuthSecret;
  if (prevNextAuthSecret) process.env.NEXTAUTH_SECRET = prevNextAuthSecret;
  const restoredIssues = validateEnv("production");
  assert(!restoredIssues.some((i) => i.variable === "AUTH_SECRET" && i.severity === "CRITICAL"), "une fois AUTH_SECRET restauré, il n'est plus signalé CRITICAL (APP_URL peut rester manquant selon l'environnement local - non lié à ce test)");

  // --- Nettoyage ---
  const allOrgIds = [orgAId, orgBId, orgADup];
  await prisma.userInvitation.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: [adminA.id, adminB.id, createdInvitee?.id ?? ""] } } });
  await prisma.notification.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.automationRule.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.etudeDossier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.tache.deleteMany({ where: { dossier: { organisationId: { in: allOrgIds } } } });
  await prisma.transmissionPackage.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossierDocument.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.typeDocumentReferentiel.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.lead.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.client.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.sousTraitant.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.mar.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.delegataireCee.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.auditLog.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA.id, adminB.id, ...(createdInvitee ? [createdInvitee.id] : [])] } } });
  for (const id of allOrgIds) {
    await prisma.organisation.delete({ where: { id } });
  }

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
