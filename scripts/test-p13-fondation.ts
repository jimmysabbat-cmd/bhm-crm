import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createOrganisation } from "../src/lib/platform/organisations";
import { getOrganisationAccessDetails, assertUsableAsPrincipalAdmin } from "../src/lib/platform/tenant-users";
import { createInvitation } from "../src/lib/invitations/service";
import { assertRuleVersionUsableForOfficial, getApplicableRuleVersion } from "../src/lib/reglementaire/engine";
import { isEtapeAccessible, getGateBlockingReasons, isReadyForProduction, isKnownStatutExterneCle } from "../src/lib/workflow-gates";
import { recalculateDossierWorkflow } from "../src/lib/workflow";

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

async function assertThrows(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
    assert(false, label);
  } catch {
    assert(true, label);
  }
}

async function main() {
  // ============================================================
  // TEST ADMIN PRINCIPAL (P13, audit SaaS section A)
  // ============================================================
  console.log("\n=== TEST ADMIN PRINCIPAL ===");
  const orgAId = await createOrganisation({ nom: "Test P13 Tenant A" });
  const orgBId = await createOrganisation({ nom: "Test P13 Tenant B" });

  const adminA = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-adminA-${Date.now()}@example.com`, name: "Admin A", role: "ADMIN", actif: true, password: "x" } });
  const commercialA = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-commA-${Date.now()}@example.com`, name: "Commercial A", role: "COMMERCIAL", actif: true, password: "x" } });
  const adminInactifA = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-adminInactifA-${Date.now()}@example.com`, name: "Admin Inactif A", role: "ADMIN", actif: false, password: "x" } });
  const adminB = await prisma.user.create({ data: { organisationId: orgBId, email: `test-p13-adminB-${Date.now()}@example.com`, name: "Admin B", role: "ADMIN", actif: true, password: "x" } });
  const platformAdmin = await prisma.user.create({ data: { organisationId: null, email: `test-p13-platform-${Date.now()}@example.com`, name: "Platform", role: "COMMERCIAL", actif: true, password: "x", isPlatformSuperAdmin: true } });

  await assertUsableAsPrincipalAdmin(orgAId, adminA.id);
  assert(true, "ADMIN actif de la même organisation : accepté");

  await assertThrows(() => assertUsableAsPrincipalAdmin(orgAId, commercialA.id), "un COMMERCIAL ne peut pas être admin principal");
  await assertThrows(() => assertUsableAsPrincipalAdmin(orgAId, adminInactifA.id), "un ADMIN désactivé ne peut pas être admin principal");
  await assertThrows(() => assertUsableAsPrincipalAdmin(orgAId, adminB.id), "cross-tenant refusé : un ADMIN d'une autre organisation ne peut pas être admin principal");
  await assertThrows(() => assertUsableAsPrincipalAdmin(orgAId, platformAdmin.id), "un PLATFORM_SUPER_ADMIN ne peut jamais être admin principal d'un tenant");

  await prisma.organisation.update({ where: { id: orgAId }, data: { principalAdminUserId: adminA.id } });

  const detailsA = await getOrganisationAccessDetails(orgAId);
  assert(detailsA.principalAdmin?.id === adminA.id, "getOrganisationAccessDetails résout le bon admin principal");
  assert(detailsA.users.find((u) => u.id === adminA.id)?.isPrincipalAdmin === true, "isPrincipalAdmin=true uniquement sur l'admin principal");
  assert(detailsA.users.find((u) => u.id === commercialA.id)?.isPrincipalAdmin === false, "isPrincipalAdmin=false pour les autres utilisateurs");
  assert(!detailsA.users.some((u) => u.id === adminB.id), "cross-tenant refusé : un utilisateur d'une autre organisation n'apparaît jamais dans la fiche");

  const loginAt = new Date();
  await prisma.user.update({ where: { id: adminA.id }, data: { lastLoginAt: loginAt } });
  const detailsAAfterLogin = await getOrganisationAccessDetails(orgAId);
  assert(detailsAAfterLogin.principalAdmin?.lastLoginAt?.getTime() === loginAt.getTime(), "lastLoginAt est bien répercuté sur la fiche plateforme");
  assert(detailsAAfterLogin.users.find((u) => u.id === commercialA.id)?.lastLoginAt === null, "lastLoginAt reste null pour un utilisateur jamais connecté");

  const invitationToken = await createInvitation({ organisationId: orgAId, email: "invite-p13@example.com", role: "ADMIN", invitedById: adminA.id });
  assert(typeof invitationToken === "string" && invitationToken.length > 0, "createInvitation (réutilisé tel quel) génère bien un token");
  const detailsAfterInvite = await getOrganisationAccessDetails(orgAId);
  const pending = detailsAfterInvite.pendingInvitations.find((i) => i.email === "invite-p13@example.com");
  assert(pending !== undefined && pending.expired === false, "invitation en attente non expirée listée avec expired=false");

  const expiredInvite = await prisma.userInvitation.create({
    data: { organisationId: orgAId, email: "expired-p13@example.com", role: "ADMIN", tokenHash: `test-expired-${Date.now()}`, invitedById: adminA.id, expiresAt: new Date(Date.now() - 1000) },
  });
  const detailsWithExpired = await getOrganisationAccessDetails(orgAId);
  assert(detailsWithExpired.pendingInvitations.find((i) => i.id === expiredInvite.id)?.expired === true, "invitation expirée listée avec expired=true");

  const usedInvite = await prisma.userInvitation.create({
    data: { organisationId: orgAId, email: "used-p13@example.com", role: "ADMIN", tokenHash: `test-used-${Date.now()}`, invitedById: adminA.id, expiresAt: new Date(Date.now() + 100_000), usedAt: new Date() },
  });
  const detailsWithUsed = await getOrganisationAccessDetails(orgAId);
  assert(!detailsWithUsed.pendingInvitations.some((i) => i.id === usedInvite.id), "une invitation déjà utilisée n'apparaît jamais dans les invitations en attente");

  // ============================================================
  // TEST GOUVERNANCE CEE (P13, audit SaaS section B)
  // ============================================================
  console.log("\n=== TEST GOUVERNANCE CEE ===");
  const regleTest = await prisma.regleReglementaire.upsert({
    where: { code: "TEST-P13-GOUVERNANCE" },
    update: {},
    create: { code: "TEST-P13-GOUVERNANCE", famille: "TEST", secteur: "AUTRE", nom: "Règle de test gouvernance P13" },
  });
  const versionBrouillon = await prisma.regleReglementaireVersion.upsert({
    where: { regleId_numeroVersion: { regleId: regleTest.id, numeroVersion: "brouillon" } },
    update: { statutValidation: "BROUILLON", publie: false },
    create: { regleId: regleTest.id, numeroVersion: "brouillon", dateDebutEffet: new Date("2026-01-01"), publie: false, formulaCode: "BAR_TH_171_CUMAC_V1", sourceNom: "Test" },
  });
  await assertThrows(async () => assertRuleVersionUsableForOfficial(versionBrouillon), "BROUILLON n'est jamais utilisable pour un calcul OFFICIEL");

  const versionAVerifier = await prisma.regleReglementaireVersion.update({ where: { id: versionBrouillon.id }, data: { statutValidation: "A_VERIFIER" } });
  await assertThrows(async () => assertRuleVersionUsableForOfficial(versionAVerifier), "A_VERIFIER n'est jamais utilisable pour un calcul OFFICIEL");

  const versionValide = await prisma.regleReglementaireVersion.update({ where: { id: versionBrouillon.id }, data: { statutValidation: "VALIDE", validatedById: adminA.id, validatedAt: new Date() } });
  await assertThrows(async () => assertRuleVersionUsableForOfficial(versionValide), "VALIDE seul (pas encore publié) n'est jamais utilisable pour un calcul OFFICIEL");

  const versionPubliee = await prisma.regleReglementaireVersion.update({ where: { id: versionBrouillon.id }, data: { statutValidation: "PUBLIE", publie: true } });
  assertRuleVersionUsableForOfficial(versionPubliee);
  assert(true, "PUBLIE est utilisable pour un calcul OFFICIEL");

  const versionArchivee = await prisma.regleReglementaireVersion.update({ where: { id: versionBrouillon.id }, data: { statutValidation: "ARCHIVE", publie: false } });
  await assertThrows(async () => assertRuleVersionUsableForOfficial(versionArchivee), "ARCHIVE n'est plus utilisable pour un calcul OFFICIEL");

  // Non-régression explicite (P7 historique) : une version créée avec
  // publie=true SANS jamais toucher statutValidation (comme le font les
  // scripts de seed/tests existants) doit continuer à être sélectionnée
  // par getApplicableRuleVersion() - la gouvernance P13 est additive,
  // jamais un filtre supplémentaire sur ce chemin historique.
  const regleLegacy = await prisma.regleReglementaire.upsert({
    where: { code: "TEST-P13-LEGACY-PUBLIE" },
    update: {},
    create: { code: "TEST-P13-LEGACY-PUBLIE", famille: "TEST", secteur: "AUTRE", nom: "Règle publiée à l'ancienne (publie seul)" },
  });
  const versionLegacyPubliee = await prisma.regleReglementaireVersion.upsert({
    where: { regleId_numeroVersion: { regleId: regleLegacy.id, numeroVersion: "v1" } },
    update: {},
    create: { regleId: regleLegacy.id, numeroVersion: "v1", dateDebutEffet: new Date("2026-01-01"), publie: true, formulaCode: "BAR_TH_171_CUMAC_V1", sourceNom: "Test" },
  });
  const resolue = await getApplicableRuleVersion("TEST-P13-LEGACY-PUBLIE", new Date("2026-06-01"));
  assert(resolue?.id === versionLegacyPubliee.id, "non-régression : publie=true seul (statutValidation par défaut BROUILLON) reste sélectionnable - publie reste la source de vérité historique");

  // ============================================================
  // TEST GATES (P13, audit SaaS section D)
  // ============================================================
  console.log("\n=== TEST GATES ===");
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatus = await prisma.dossierStatus.findFirstOrThrow();
  const clientGates = await prisma.client.create({ data: { organisationId: orgAId, prenom: "Client", nom: "Gates" } });
  const dossierGates = await prisma.dossier.create({
    data: { reference: `TEST-P13-GATES-${Math.random().toString(36).slice(2, 8)}`, clientId: clientGates.id, organisationId: orgAId, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 100_000, createdById: adminA.id },
  });

  const programmeGates = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme Test Gates", code: "TEST_P13_GATES" } });
  const versionGates = await prisma.programmeVersion.create({ data: { programmeId: programmeGates.id, numeroVersion: "1", publie: true } });

  const etapeA = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_A", nom: "Étape A (sans condition)", ordre: 0 } });
  const etapeStatutExterne = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_STATUT_EXTERNE", nom: "Nécessite accord ANAH", ordre: 1 } });
  const etapeValidationManuelle = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_VALIDATION", nom: "Nécessite validation manuelle", ordre: 2 } });
  const etapeNonBloquante = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_NON_BLOQUANTE", nom: "Condition facultative", ordre: 3 } });
  const etapeCleInconnue = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_CLE_INCONNUE", nom: "Clé statut externe inconnue", ordre: 4 } });
  const etapeDependanceViaCondition = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_DEP_VIA_CONDITION", nom: "Dépendance exprimée via EtapeCondition", ordre: 5 } });

  const conditionStatutExterne = await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeStatutExterne.id, type: "STATUT_EXTERNE", libelle: "Accord ANAH reçu", statutExterneCle: "ANAH_ACCORD_RECU", obligatoire: true, bloquant: true },
  });
  const conditionValidation = await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeValidationManuelle.id, type: "VALIDATION_INTERVENANT", libelle: "Validation responsable travaux", obligatoire: true, bloquant: true },
  });
  await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeNonBloquante.id, type: "STATUT_EXTERNE", libelle: "Condition facultative jamais satisfaite", statutExterneCle: "ANAH_ACCORD_RECU", obligatoire: true, bloquant: false },
  });
  await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeCleInconnue.id, type: "STATUT_EXTERNE", libelle: "Clé inconnue (jamais satisfaite)", statutExterneCle: "CLE_QUI_N_EXISTE_PAS", obligatoire: true, bloquant: true },
  });
  await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeDependanceViaCondition.id, type: "DEPENDANCE_ETAPE", libelle: "Dépend de l'étape A", dependsOnEtapeId: etapeA.id, obligatoire: true, bloquant: true },
  });

  assert(isKnownStatutExterneCle("ANAH_ACCORD_RECU"), "clé STATUT_EXTERNE connue reconnue comme telle");
  assert(!isKnownStatutExterneCle("CLE_QUI_N_EXISTE_PAS"), "clé STATUT_EXTERNE inconnue jamais whitelistée - aucune règle codée par nom de programme");

  await prisma.dossier.update({ where: { id: dossierGates.id }, data: { programmeVersionId: versionGates.id } });
  await recalculateDossierWorkflow(dossierGates.id);

  async function statutEtape(etapeProgrammeId: string) {
    const de = await prisma.dossierEtape.findFirst({ where: { dossierId: dossierGates.id, etapeProgrammeId } });
    return de?.statut;
  }

  assert((await statutEtape(etapeA.id)) === "A_FAIRE", "étape sans condition : disponible immédiatement");
  assert((await statutEtape(etapeStatutExterne.id)) === "NON_DISPONIBLE", "gate STATUT_EXTERNE non satisfaite : étape non disponible");
  assert((await statutEtape(etapeValidationManuelle.id)) === "NON_DISPONIBLE", "gate VALIDATION_INTERVENANT non satisfaite : étape non disponible");
  assert((await statutEtape(etapeNonBloquante.id)) === "A_FAIRE", "condition obligatoire mais NON bloquante : n'empêche jamais la disponibilité");
  assert((await statutEtape(etapeCleInconnue.id)) === "NON_DISPONIBLE", "clé STATUT_EXTERNE inconnue : jamais satisfaite (fail closed)");
  assert((await statutEtape(etapeDependanceViaCondition.id)) === "NON_DISPONIBLE", "DEPENDANCE_ETAPE via EtapeCondition : non disponible tant que l'étape ciblée n'est pas TERMINE");

  assert(!(await isEtapeAccessible(dossierGates.id, etapeStatutExterne.id, orgAId)), "isEtapeAccessible=false tant que la gate STATUT_EXTERNE n'est pas satisfaite");
  const reasonsAvant = await getGateBlockingReasons(dossierGates.id, etapeStatutExterne.id, orgAId);
  assert(reasonsAvant.some((r) => r.conditionId === conditionStatutExterne.id), "getGateBlockingReasons rapporte la condition non satisfaite");

  await prisma.dossier.update({ where: { id: dossierGates.id }, data: { dateOctroiAnah: new Date() } });
  await recalculateDossierWorkflow(dossierGates.id);
  assert((await statutEtape(etapeStatutExterne.id)) === "A_FAIRE", "après satisfaction (dateOctroiAnah renseignée) : étape promue disponible");
  assert(await isEtapeAccessible(dossierGates.id, etapeStatutExterne.id, orgAId), "isEtapeAccessible=true une fois la gate satisfaite");

  await prisma.dossierEtapeConditionValidation.create({
    data: { etapeConditionId: conditionValidation.id, dossierId: dossierGates.id, satisfiedAt: new Date(), satisfiedById: adminA.id, commentaire: "Validé pour le test" },
  });
  await recalculateDossierWorkflow(dossierGates.id);
  assert((await statutEtape(etapeValidationManuelle.id)) === "A_FAIRE", "validation manuelle enregistrée : étape promue disponible");

  await prisma.etapeDependance.create({ data: { etapeId: etapeDependanceViaCondition.id, dependsOnEtapeId: etapeA.id } });
  const dossierEtapeA = await prisma.dossierEtape.findFirstOrThrow({ where: { dossierId: dossierGates.id, etapeProgrammeId: etapeA.id } });
  await prisma.dossierEtape.update({ where: { id: dossierEtapeA.id }, data: { statut: "TERMINE", dateTerminee: new Date() } });
  await recalculateDossierWorkflow(dossierGates.id);
  assert((await statutEtape(etapeDependanceViaCondition.id)) === "A_FAIRE", "DEPENDANCE_ETAPE via EtapeCondition satisfaite une fois l'étape A TERMINE");

  // Document requis (P10 existant, réutilisé tel quel par getGateBlockingReasons)
  const etapeDocument = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionGates.id, code: "ETAPE_DOCUMENT", nom: "Nécessite un document", ordre: 6 } });
  const typeDocGates = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgAId, code: "PIECE_TEST_GATES", nom: "Pièce test gates" } });
  await prisma.documentRequirement.create({ data: { organisationId: orgAId, typeDocumentId: typeDocGates.id, etapeProgrammeId: etapeDocument.id, blocking: true, obligatoire: true } });

  const reasonsDocAvant = await getGateBlockingReasons(dossierGates.id, etapeDocument.id, orgAId);
  assert(reasonsDocAvant.some((r) => r.source === "DOCUMENT"), "document bloquant manquant : remonté par getGateBlockingReasons (source DOCUMENT)");

  await prisma.dossierDocument.create({
    data: { dossierId: dossierGates.id, type: "AUTRE", nomFichier: "piece.pdf", cheminFichier: "test/piece.pdf", mimeType: "application/pdf", tailleOctets: 10, organisationId: orgAId, typeDocumentId: typeDocGates.id, statut: "VALIDE" },
  });
  const reasonsDocApres = await getGateBlockingReasons(dossierGates.id, etapeDocument.id, orgAId);
  assert(!reasonsDocApres.some((r) => r.source === "DOCUMENT"), "document validé : le blocage documentaire disparaît");

  // isReadyForProduction
  const readyAvant = await isReadyForProduction(dossierGates.id, orgAId);
  assert(!readyAvant.ready, "isReadyForProduction=false tant que la clé inconnue (jamais satisfaite) bloque une étape obligatoire");

  await prisma.etapeProgramme.update({ where: { id: etapeCleInconnue.id }, data: { obligatoire: false } });
  const readyApres = await isReadyForProduction(dossierGates.id, orgAId);
  assert(readyApres.ready, "isReadyForProduction=true une fois toutes les étapes obligatoires réellement débloquées");

  // ============================================================
  // TEST PARTENAIRES (P13, audit SaaS section E)
  // ============================================================
  console.log("\n=== TEST PARTENAIRES ===");
  const partenaire1 = await prisma.partenaire.create({ data: { organisationId: orgAId, nom: "Partenaire Multi-Rôles" } });
  await prisma.partenaireRole.create({ data: { partenaireId: partenaire1.id, role: "SOUS_TRAITANT" } });
  await prisma.partenaireRole.create({ data: { partenaireId: partenaire1.id, role: "MANDATAIRE" } });

  const rolesP1 = await prisma.partenaireRole.findMany({ where: { partenaireId: partenaire1.id } });
  assert(rolesP1.length === 2 && rolesP1.some((r) => r.role === "SOUS_TRAITANT") && rolesP1.some((r) => r.role === "MANDATAIRE"), "un même Partenaire peut cumuler plusieurs PartenaireRole");

  const userDirection = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-direction-${Date.now()}@example.com`, name: "Direction Partenaire", role: "SOUS_TRAITANT", actif: true, password: "x", partenaireId: partenaire1.id, partenaireFonction: "Direction" } });
  const userExploitation = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-exploitation-${Date.now()}@example.com`, name: "Exploitation Partenaire", role: "SOUS_TRAITANT", actif: true, password: "x", partenaireId: partenaire1.id, partenaireFonction: "Exploitation" } });
  const usersP1 = await prisma.user.findMany({ where: { partenaireId: partenaire1.id } });
  assert(usersP1.length === 2 && usersP1.some((u) => u.id === userDirection.id) && usersP1.some((u) => u.id === userExploitation.id), "plusieurs utilisateurs peuvent être rattachés au même Partenaire avec des fonctions différentes");
  assert(usersP1.find((u) => u.id === userDirection.id)?.partenaireFonction === "Direction" && usersP1.find((u) => u.id === userExploitation.id)?.partenaireFonction === "Exploitation", "partenaireFonction distingue bien les deux utilisateurs");

  const partenaire2 = await prisma.partenaire.create({ data: { organisationId: orgAId, nom: "Partenaire 2 org A" } });
  const partenaire3 = await prisma.partenaire.create({ data: { organisationId: orgBId, nom: "Partenaire org B" } });
  const partenairesOrgA = await prisma.partenaire.findMany({ where: { organisationId: orgAId } });
  assert(partenairesOrgA.some((p) => p.id === partenaire1.id) && partenairesOrgA.some((p) => p.id === partenaire2.id) && !partenairesOrgA.some((p) => p.id === partenaire3.id), "isolation cross-tenant : un partenaire d'une autre organisation n'apparaît jamais dans la liste scopée");

  await prisma.partenaireCapability.create({ data: { partenaireId: partenaire1.id, cle: "CREER_LEAD" } });
  await assertThrows(() => prisma.partenaireCapability.create({ data: { partenaireId: partenaire1.id, cle: "CREER_LEAD" } }), "une capacité ne peut pas être dupliquée pour le même partenaire (contrainte unique partenaireId+cle)");

  // Anciennes structures toujours fonctionnelles pendant la transition
  const sousTraitantExistant = await prisma.sousTraitant.findFirst({ where: { organisationId: orgAId }, select: { id: true, nom: true, partenaireId: true } });
  if (sousTraitantExistant) {
    assert(typeof sousTraitantExistant.nom === "string", "SousTraitant reste pleinement lisible/fonctionnel (colonnes historiques intactes)");
  } else {
    assert(true, "aucun SousTraitant préexistant dans cette organisation de test - non bloquant");
  }
  const sousTraitantNouveau = await prisma.sousTraitant.create({ data: { organisationId: orgAId, nom: "ST créé sans Partenaire (P13)" } });
  assert(sousTraitantNouveau.partenaireId === null, "un SousTraitant peut toujours être créé SANS Partenaire (colonne nullable, transition non imposée)");
  const userViaAncienneColonne = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-ancien-${Date.now()}@example.com`, name: "Via ancienne colonne", role: "SOUS_TRAITANT", actif: true, password: "x", sousTraitantId: sousTraitantNouveau.id } });
  assert(userViaAncienneColonne.sousTraitantId === sousTraitantNouveau.id && userViaAncienneColonne.partenaireId === null, "User.sousTraitantId (ancien mécanisme P11) reste pleinement fonctionnel, indépendamment de partenaireId");

  console.log(`\n${passed} OK, ${failed} FAIL`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
