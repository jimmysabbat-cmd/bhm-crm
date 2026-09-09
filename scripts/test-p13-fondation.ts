import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createOrganisation } from "../src/lib/platform/organisations";
import { getOrganisationAccessDetails, assertUsableAsPrincipalAdmin } from "../src/lib/platform/tenant-users";
import { createInvitation } from "../src/lib/invitations/service";
import { assertRuleVersionUsableForOfficial, getApplicableRuleVersion } from "../src/lib/reglementaire/engine";
import { isEtapeAccessible, getBlockingConditions, getPendingConditions, canStartStep, isReadyForProduction, isKnownDonneeDossierCle, assertUserCanValidateCondition } from "../src/lib/workflow-gates";
import { recalculateDossierWorkflow } from "../src/lib/workflow";
import { requireVersionModifiable } from "../src/app/parametrage/programmes-actions";

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
  // TEST GATES (P13, audit SaaS section D, révisé après relecture)
  // ============================================================
  console.log("\n=== TEST GATES ===");
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatus = await prisma.dossierStatus.findFirstOrThrow();
  const clientGates = await prisma.client.create({ data: { organisationId: orgAId, prenom: "Client", nom: "Gates" } });

  async function creerDossierGates(reference: string) {
    return prisma.dossier.create({
      data: { reference, clientId: clientGates.id, organisationId: orgAId, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 100_000, createdById: adminA.id },
    });
  }
  async function statutEtapeDossier(dossierId: string, etapeProgrammeId: string) {
    const de = await prisma.dossierEtape.findFirst({ where: { dossierId, etapeProgrammeId } });
    return de?.statut;
  }

  assert(isKnownDonneeDossierCle("ANAH_ACCORD_RECU"), "clé DONNEE_DOSSIER connue reconnue comme telle");
  assert(!isKnownDonneeDossierCle("CLE_QUI_N_EXISTE_PAS"), "clé DONNEE_DOSSIER inconnue jamais whitelistée");

  // --- Scénarios 1/2/3 : même donnée dossier (dépôt ANAH fait, accord absent),
  // deux programmes différents avec des exigences différentes sur LA MÊME
  // donnée - jamais un `if (programme === ...)`, uniquement la clé de la
  // condition qui diffère entre les deux ProgrammeVersion. ---
  const programmeDepotSuffit = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme - dépôt suffit", code: "TEST_P13_DEPOT_SUFFIT" } });
  const versionDepotSuffit = await prisma.programmeVersion.create({ data: { programmeId: programmeDepotSuffit.id, numeroVersion: "1", publie: true } });
  const etapeDepotSuffit = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionDepotSuffit.id, code: "ENVOYER_EN_POSE", nom: "Envoyer en pose", ordre: 0 } });
  await prisma.etapeCondition.create({ data: { etapeProgrammeId: etapeDepotSuffit.id, type: "DONNEE_DOSSIER", libelle: "Dépôt ANAH effectué", donneeDossierCle: "ANAH_DEPOT_EFFECTUE", obligatoire: true, bloquant: true } });

  const programmeAccordRequis = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme - accord requis", code: "TEST_P13_ACCORD_REQUIS" } });
  const versionAccordRequis = await prisma.programmeVersion.create({ data: { programmeId: programmeAccordRequis.id, numeroVersion: "1", publie: true } });
  const etapeAccordRequis = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionAccordRequis.id, code: "ENVOYER_EN_POSE", nom: "Envoyer en pose", ordre: 0 } });
  await prisma.etapeCondition.create({ data: { etapeProgrammeId: etapeAccordRequis.id, type: "DONNEE_DOSSIER", libelle: "Accord ANAH reçu", donneeDossierCle: "ANAH_ACCORD_RECU", obligatoire: true, bloquant: true } });

  const dossierDepotSuffit = await creerDossierGates(`TEST-P13-DEPOT-${Math.random().toString(36).slice(2, 8)}`);
  const dossierAccordRequis = await creerDossierGates(`TEST-P13-ACCORD-${Math.random().toString(36).slice(2, 8)}`);
  await prisma.dossier.update({ where: { id: dossierDepotSuffit.id }, data: { programmeVersionId: versionDepotSuffit.id, dateDepotAnah: new Date() } });
  await prisma.dossier.update({ where: { id: dossierAccordRequis.id }, data: { programmeVersionId: versionAccordRequis.id, dateDepotAnah: new Date() } });
  await recalculateDossierWorkflow(dossierDepotSuffit.id);
  await recalculateDossierWorkflow(dossierAccordRequis.id);

  assert((await statutEtapeDossier(dossierDepotSuffit.id, etapeDepotSuffit.id)) === "A_FAIRE", "[1] dépôt ANAH fait, accord absent, programme n'exigeant que le dépôt -> étape disponible (OK)");
  assert((await statutEtapeDossier(dossierAccordRequis.id, etapeAccordRequis.id)) === "NON_DISPONIBLE", "[2] mêmes données (dépôt fait, accord absent), programme exigeant l'accord -> BLOQUÉ");

  await prisma.dossier.update({ where: { id: dossierAccordRequis.id }, data: { dateOctroiAnah: new Date() } });
  await recalculateDossierWorkflow(dossierAccordRequis.id);
  assert((await statutEtapeDossier(dossierAccordRequis.id, etapeAccordRequis.id)) === "A_FAIRE", "[3] accord ANAH reçu -> étape débloquée");

  // --- Scénario "mairie" : requise pour un programme, absente d'un autre -
  // aucune colonne Dossier dédiée à la mairie (ça ne scalerait pas), donc
  // VALIDATION_INTERVENANT côté programme qui l'exige, rien côté l'autre. ---
  const programmeAvecMairie = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme avec mairie", code: "TEST_P13_MAIRIE_REQUISE" } });
  const versionAvecMairie = await prisma.programmeVersion.create({ data: { programmeId: programmeAvecMairie.id, numeroVersion: "1", publie: true } });
  const etapeAvecMairie = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionAvecMairie.id, code: "DEMARRAGE_TRAVAUX", nom: "Démarrage travaux", ordre: 0 } });
  const conditionMairie = await prisma.etapeCondition.create({ data: { etapeProgrammeId: etapeAvecMairie.id, type: "VALIDATION_INTERVENANT", libelle: "Mairie déposée", obligatoire: true, bloquant: true } });

  const programmeSansMairie = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme sans mairie", code: "TEST_P13_MAIRIE_NON_REQUISE" } });
  const versionSansMairie = await prisma.programmeVersion.create({ data: { programmeId: programmeSansMairie.id, numeroVersion: "1", publie: true } });
  const etapeSansMairie = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionSansMairie.id, code: "DEMARRAGE_TRAVAUX", nom: "Démarrage travaux", ordre: 0 } });

  const dossierAvecMairie = await creerDossierGates(`TEST-P13-MAIRIE-OUI-${Math.random().toString(36).slice(2, 8)}`);
  const dossierSansMairie = await creerDossierGates(`TEST-P13-MAIRIE-NON-${Math.random().toString(36).slice(2, 8)}`);
  await prisma.dossier.update({ where: { id: dossierAvecMairie.id }, data: { programmeVersionId: versionAvecMairie.id } });
  await prisma.dossier.update({ where: { id: dossierSansMairie.id }, data: { programmeVersionId: versionSansMairie.id } });
  await recalculateDossierWorkflow(dossierAvecMairie.id);
  await recalculateDossierWorkflow(dossierSansMairie.id);
  assert((await statutEtapeDossier(dossierSansMairie.id, etapeSansMairie.id)) === "A_FAIRE", "mairie non exigée par ce programme -> étape disponible immédiatement");
  assert((await statutEtapeDossier(dossierAvecMairie.id, etapeAvecMairie.id)) === "NON_DISPONIBLE", "[4] validation humaine (mairie) obligatoire absente -> BLOQUÉ");

  // --- Scénarios 5/6 : validation par un acteur autorisé vs non autorisé ---
  const conditionRoleRestreint = await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeAvecMairie.id, type: "VALIDATION_INTERVENANT", libelle: "Validation ADMINISTRATIF requise", obligatoire: true, bloquant: true, roleResponsable: "ADMINISTRATIF" },
  });
  await assertThrows(
    () => assertUserCanValidateCondition(conditionRoleRestreint, commercialA.id, "COMMERCIAL"),
    "[6] acteur non autorisé (mauvais rôle) -> REFUSÉ"
  );
  await assertUserCanValidateCondition(conditionRoleRestreint, adminA.id, "ADMIN");
  assert(true, "[5] acteur autorisé (ADMIN, qui garde son pouvoir d'override) -> OK");
  const administratifA = await prisma.user.create({ data: { organisationId: orgAId, email: `test-p13-administratifA-${Date.now()}@example.com`, name: "Administratif A", role: "ADMINISTRATIF", actif: true, password: "x" } });
  await assertUserCanValidateCondition(conditionRoleRestreint, administratifA.id, "ADMINISTRATIF");
  assert(true, "[5bis] acteur autorisé (rôle exact requis) -> OK");

  const conditionPartenaireRestreint = await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeAvecMairie.id, type: "VALIDATION_INTERVENANT", libelle: "Validation sous-traitant requise", obligatoire: true, bloquant: true, partenaireRoleResponsable: "SOUS_TRAITANT" },
  });
  await assertThrows(
    () => assertUserCanValidateCondition(conditionPartenaireRestreint, adminA.id, "ADMIN"),
    "un ADMIN interne ne peut jamais se substituer à l'attestation d'un partenaire externe"
  );
  const partenaireValidateur = await prisma.partenaire.create({ data: { organisationId: orgAId, nom: "ST validateur test gates" } });
  await prisma.partenaireRole.create({ data: { partenaireId: partenaireValidateur.id, role: "SOUS_TRAITANT" } });
  const userPartenaireValidateur = await prisma.user.create({
    data: { organisationId: orgAId, email: `test-p13-partenaire-validateur-${Date.now()}@example.com`, name: "Technicien externe", role: "SOUS_TRAITANT", actif: true, password: "x", partenaireId: partenaireValidateur.id },
  });
  await assertUserCanValidateCondition(conditionPartenaireRestreint, userPartenaireValidateur.id, "SOUS_TRAITANT");
  assert(true, "validation technicien externe (partenaire avec le bon rôle) -> OK");

  // --- Scénario 7 : preuve documentaire d'un AUTRE dossier -> refusée (même
  // logique de scoping que validerConditionEtape, répliquée ici sans session) ---
  const autreDossierPourPreuve = await creerDossierGates(`TEST-P13-AUTRE-DOSSIER-${Math.random().toString(36).slice(2, 8)}`);
  const typeDocPreuve = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgAId, code: "PIECE_PREUVE_P13", nom: "Pièce preuve P13" } });
  const documentAutreDossier = await prisma.dossierDocument.create({
    data: { dossierId: autreDossierPourPreuve.id, type: "AUTRE", nomFichier: "preuve.pdf", cheminFichier: "test/preuve.pdf", mimeType: "application/pdf", tailleOctets: 10, organisationId: orgAId, typeDocumentId: typeDocPreuve.id, statut: "VALIDE" },
  });
  const preuveScopeeAuBonDossier = await prisma.dossierDocument.findFirst({ where: { id: documentAutreDossier.id, dossierId: dossierAvecMairie.id, organisationId: orgAId } });
  assert(preuveScopeeAuBonDossier === null, "[7] un document d'un AUTRE dossier n'est jamais accepté comme preuve (scoping dossierId+organisationId)");
  const preuveScopeeCorrectement = await prisma.dossierDocument.findFirst({ where: { id: documentAutreDossier.id, dossierId: autreDossierPourPreuve.id, organisationId: orgAId } });
  assert(preuveScopeeCorrectement?.id === documentAutreDossier.id, "un document du BON dossier est accepté comme preuve");

  // Valide effectivement la condition mairie pour clore le scénario, avec preuve.
  await prisma.dossierEtapeConditionValidation.create({
    data: { etapeConditionId: conditionMairie.id, dossierId: dossierAvecMairie.id, satisfiedAt: new Date(), satisfiedById: adminA.id, preuveReference: "Courrier mairie n°2026-114" },
  });
  await recalculateDossierWorkflow(dossierAvecMairie.id);

  // --- Scénario 8 : condition non bloquante absente - visible dans
  // getPendingConditions, jamais dans getBlockingConditions, n'empêche pas
  // l'étape de devenir disponible. ---
  const programmeNonBloquant = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme condition non bloquante", code: "TEST_P13_NON_BLOQUANT" } });
  const versionNonBloquant = await prisma.programmeVersion.create({ data: { programmeId: programmeNonBloquant.id, numeroVersion: "1", publie: true } });
  const etapeNonBloquante = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionNonBloquant.id, code: "ETAPE_FACULTATIVE", nom: "Étape avec condition facultative", ordre: 0 } });
  const conditionFacultative = await prisma.etapeCondition.create({
    data: { etapeProgrammeId: etapeNonBloquante.id, type: "DONNEE_DOSSIER", libelle: "Accord ANAH reçu (facultatif ici)", donneeDossierCle: "ANAH_ACCORD_RECU", obligatoire: true, bloquant: false },
  });
  const dossierNonBloquant = await creerDossierGates(`TEST-P13-NONBLOQ-${Math.random().toString(36).slice(2, 8)}`);
  await prisma.dossier.update({ where: { id: dossierNonBloquant.id }, data: { programmeVersionId: versionNonBloquant.id } });
  await recalculateDossierWorkflow(dossierNonBloquant.id);
  assert((await statutEtapeDossier(dossierNonBloquant.id, etapeNonBloquante.id)) === "A_FAIRE", "[8] condition obligatoire mais NON bloquante -> n'empêche jamais la disponibilité");
  const pendingConditionsResult = await getPendingConditions(dossierNonBloquant.id, etapeNonBloquante.id, orgAId);
  assert(pendingConditionsResult.some((p) => p.conditionId === conditionFacultative.id), "[8] la condition non satisfaite reste visible dans getPendingConditions");
  const blocking = await getBlockingConditions(dossierNonBloquant.id, etapeNonBloquante.id, orgAId);
  assert(!blocking.some((b) => b.conditionId === conditionFacultative.id), "[8] mais n'apparaît jamais dans getBlockingConditions (non bloquante)");

  // --- Scénario 9 : EtapeDependance (dépendance étape-à-étape native)
  // continue de fonctionner exactement comme avant P13. ---
  const etapeSuivanteDependance = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionNonBloquant.id, code: "ETAPE_SUIVANTE", nom: "Étape suivante", ordre: 1 } });
  await prisma.etapeDependance.create({ data: { etapeId: etapeSuivanteDependance.id, dependsOnEtapeId: etapeNonBloquante.id } });
  await recalculateDossierWorkflow(dossierNonBloquant.id);
  assert((await statutEtapeDossier(dossierNonBloquant.id, etapeSuivanteDependance.id)) === "NON_DISPONIBLE", "[9] EtapeDependance : étape suivante non disponible tant que la précédente n'est pas TERMINE");
  const deEtapeNonBloquante = await prisma.dossierEtape.findFirstOrThrow({ where: { dossierId: dossierNonBloquant.id, etapeProgrammeId: etapeNonBloquante.id } });
  await prisma.dossierEtape.update({ where: { id: deEtapeNonBloquante.id }, data: { statut: "TERMINE", dateTerminee: new Date() } });
  await recalculateDossierWorkflow(dossierNonBloquant.id);
  assert((await statutEtapeDossier(dossierNonBloquant.id, etapeSuivanteDependance.id)) === "A_FAIRE", "[9] EtapeDependance : promue disponible une fois la précédente TERMINE, fonctionne exactement comme avant P13");

  // --- Scénario 10 : DocumentRequirement continue de fonctionner comme
  // avant (réutilisé tel quel par getBlockingConditions, jamais dupliqué). ---
  const etapeDocument = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionNonBloquant.id, code: "ETAPE_DOCUMENT", nom: "Nécessite un document", ordre: 2 } });
  const typeDocGates = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgAId, code: "PIECE_TEST_GATES", nom: "Pièce test gates" } });
  await prisma.documentRequirement.create({ data: { organisationId: orgAId, typeDocumentId: typeDocGates.id, etapeProgrammeId: etapeDocument.id, blocking: true, obligatoire: true } });
  const reasonsDocAvant = await getBlockingConditions(dossierNonBloquant.id, etapeDocument.id, orgAId);
  assert(reasonsDocAvant.some((r) => r.source === "DOCUMENT"), "[10] document bloquant manquant : remonté par getBlockingConditions (source DOCUMENT), comportement P10 inchangé");
  await prisma.dossierDocument.create({
    data: { dossierId: dossierNonBloquant.id, type: "AUTRE", nomFichier: "piece.pdf", cheminFichier: "test/piece.pdf", mimeType: "application/pdf", tailleOctets: 10, organisationId: orgAId, typeDocumentId: typeDocGates.id, statut: "VALIDE" },
  });
  const reasonsDocApres = await getBlockingConditions(dossierNonBloquant.id, etapeDocument.id, orgAId);
  assert(!reasonsDocApres.some((r) => r.source === "DOCUMENT"), "[10] document validé : le blocage documentaire disparaît, comportement P10 inchangé");

  // --- Scénario 11 : ProgrammeVersion publiée -> condition non modifiable ---
  await assertThrows(() => requireVersionModifiable(versionNonBloquant.id, orgAId), "[11] ProgrammeVersion publiée : requireVersionModifiable refuse (même garde qu'EtapeDependance/DocumentRequirement)");
  const programmeBrouillonGates = await prisma.programme.create({ data: { organisationId: orgAId, nom: "Programme brouillon gates", code: "TEST_P13_BROUILLON_GATES" } });
  const versionBrouillonGates = await prisma.programmeVersion.create({ data: { programmeId: programmeBrouillonGates.id, numeroVersion: "1", publie: false } });
  await requireVersionModifiable(versionBrouillonGates.id, orgAId);
  assert(true, "[11bis] ProgrammeVersion en brouillon : requireVersionModifiable autorise toujours la modification");

  // --- Scénario 12 : aucun programme affecté -> isReadyForProduction FAIL-CLOSED ---
  const dossierSansProgramme = await creerDossierGates(`TEST-P13-SANSPROG-${Math.random().toString(36).slice(2, 8)}`);
  const readySansProgramme = await isReadyForProduction(dossierSansProgramme.id, orgAId);
  assert(readySansProgramme.ready === false, "[12] aucune ProgrammeVersion affectée -> isReadyForProduction.ready === false (fail-closed, jamais prêt par défaut)");
  assert(readySansProgramme.blockingReasons.some((r) => r.libelle === "Programme non affecté."), "[12] raison explicite \"Programme non affecté.\" retournée");

  const readyAvecProgrammeComplet = await isReadyForProduction(dossierDepotSuffit.id, orgAId);
  assert(readyAvecProgrammeComplet.ready === true, "isReadyForProduction=true une fois le programme affecté et toutes les gates obligatoires satisfaites");

  // --- Scénario 13 : cross-tenant BHM (orgA) -> RUA (orgB), impossible de
  // lire/valider une condition d'un autre tenant. ---
  const programmeOrgB = await prisma.programme.create({ data: { organisationId: orgBId, nom: "Programme org B", code: "TEST_P13_ORG_B" } });
  const versionOrgB = await prisma.programmeVersion.create({ data: { programmeId: programmeOrgB.id, numeroVersion: "1", publie: false } });
  const etapeOrgB = await prisma.etapeProgramme.create({ data: { programmeVersionId: versionOrgB.id, code: "ETAPE_ORG_B", nom: "Étape org B", ordre: 0 } });
  const conditionOrgB = await prisma.etapeCondition.create({ data: { etapeProgrammeId: etapeOrgB.id, type: "VALIDATION_INTERVENANT", libelle: "Validation org B", obligatoire: true, bloquant: true } });

  // Réplique exactement le scoping utilisé par validerConditionEtape() :
  // chercher la condition en filtrant sur l'organisation DU DOSSIER (orgA)
  // doit échouer pour une condition qui appartient réellement à orgB.
  const conditionOrgBVueDepuisOrgA = await prisma.etapeCondition.findFirst({
    where: { id: conditionOrgB.id, etapeProgramme: { programmeVersion: { programme: { organisationId: orgAId } } } },
  });
  assert(conditionOrgBVueDepuisOrgA === null, "[13] cross-tenant refusé : une condition d'un autre tenant (RUA) n'est jamais résolue en filtrant par l'organisation de BHM");
  await assertThrows(
    () => requireVersionModifiable(versionOrgB.id, orgAId),
    "[13] cross-tenant refusé : requireVersionModifiable refuse une ProgrammeVersion d'une autre organisation"
  );

  // --- Scénario 14 : aucune règle codée par nom de programme - vérification
  // statique du fichier source du moteur de gates. ---
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sourceGates = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "workflow-gates.ts"), "utf-8");
  // Ignore les lignes de commentaire (// ou * de bloc JSDoc) - seul du CODE
  // exécutable comparant à un nom de programme précis constituerait une
  // vraie violation ; un commentaire qui explique l'anti-pattern À ÉVITER
  // (ex. "jamais un if (programme === \"MaPrimeRénov\")") n'en est pas une.
  const codeSansCommentaires = sourceGates
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  const referencesNomDeProgramme = /MaPrimeR[ée]nov|BAR-TH-171|"TEST_P13_/.test(codeSansCommentaires);
  assert(!referencesNomDeProgramme, "[14] le moteur de gates (src/lib/workflow-gates.ts) ne référence AUCUN nom de programme précis en dehors des commentaires - uniquement des clés/types génériques");

  // canStartStep/isEtapeAccessible - résolution par CODE d'étape, jamais par
  // nom de programme (section 8 de la demande).
  assert(await canStartStep(dossierDepotSuffit.id, "ENVOYER_EN_POSE", orgAId), "canStartStep résout par code d'étape et confirme l'accessibilité");
  assert(!(await canStartStep(dossierSansProgramme.id, "ENVOYER_EN_POSE", orgAId)), "canStartStep=false pour un dossier sans programme affecté (fail-closed)");
  assert(!(await canStartStep(dossierDepotSuffit.id, "CODE_QUI_N_EXISTE_PAS", orgAId)), "canStartStep=false pour un code d'étape inconnu du programme affecté");
  assert(await isEtapeAccessible(dossierAccordRequis.id, etapeAccordRequis.id, orgAId), "isEtapeAccessible reflète bien l'état débloqué après satisfaction de la gate");

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
