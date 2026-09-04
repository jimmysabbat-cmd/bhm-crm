import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getDocumentChecklistForDossier } from "../src/lib/documents/checklist";
import { isDocumentExpired } from "../src/lib/documents/expiration";
import { getDocumentBlockingReasons, getBlockingReasonsForEtape } from "../src/lib/documents/blocking";
import { isSensitiveTypeDocumentCode } from "../src/lib/documents/sensitive";
import {
  buildTransmissionPackagePreview,
  createTransmissionPackage,
  isTransmissionPackageStale,
} from "../src/lib/documents/transmission";
import { getMissingDocumentsRelanceData } from "../src/lib/documents/relance";
import { logAudit } from "../src/lib/audit";
import { hasPermission, type UserContext } from "../src/lib/authz";
import { calculateCeeCumac } from "../src/lib/reglementaire/engine";

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

const DATE_ENGAGEMENT_DEMO = new Date("2026-06-15");

async function main() {
  // ============================================================
  // Fixtures : une organisation isolée, un client/dossier principal, les
  // référentiels réels (DossierType/DossierStatus). Les exigences
  // documentaires créées ici sont org-scopées (organisationId: org.id) et
  // "règle interne" (étape/règle/typeTravaux tous null) sauf mention
  // contraire, pour rester strictement isolées des exigences globales
  // seedées (seed-documents.ts) et des autres tests.
  // ============================================================
  const org = await prisma.organisation.create({ data: { nom: "Test Documents P10", slug: `test-documents-p10-${Date.now()}` } });
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatus = await prisma.dossierStatus.findFirstOrThrow();

  const admin = await prisma.user.create({ data: { organisationId: org.id, email: `test-p10-admin-${Date.now()}@example.com`, name: "Admin P10", role: "ADMIN", actif: true, password: "x" } });
  const administratif = await prisma.user.create({ data: { organisationId: org.id, email: `test-p10-administratif-${Date.now()}@example.com`, name: "Administratif P10", role: "ADMINISTRATIF", actif: true, password: "x" } });
  const commercial = await prisma.user.create({ data: { organisationId: org.id, email: `test-p10-commercial-${Date.now()}@example.com`, name: "Commercial P10", role: "COMMERCIAL", actif: true, password: "x" } });
  const compta = await prisma.user.create({ data: { organisationId: org.id, email: `test-p10-compta-${Date.now()}@example.com`, name: "Compta P10", role: "COMPTA", actif: true, password: "x" } });

  const ctxAdmin: UserContext = { userId: admin.id, organisationId: org.id, role: "ADMIN" };
  const ctxAdministratif: UserContext = { userId: administratif.id, organisationId: org.id, role: "ADMINISTRATIF" };
  const ctxCommercial: UserContext = { userId: commercial.id, organisationId: org.id, role: "COMMERCIAL" };
  const ctxCompta: UserContext = { userId: compta.id, organisationId: org.id, role: "COMPTA" };
  void ctxAdmin;

  const client1 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "Documents" } });
  const dossier1 = await prisma.dossier.create({
    data: { reference: `TEST-P10-${Math.random().toString(36).slice(2, 8)}`, clientId: client1.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 1_000_000 },
  });

  function fakeFile(name: string) {
    return { nomFichier: name, cheminFichier: `test/${org.id}/${name}`, mimeType: "application/pdf", tailleOctets: 12_345 };
  }

  // ============================================================
  // TEST 1 - exigence obligatoire + bloquante sans document -> MANQUANT,
  // remonte dans getDocumentBlockingReasons.
  // ============================================================
  console.log("\n=== TEST 1 - exigence bloquante sans document -> MANQUANT + bloquant ===");
  const typeDevis = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "DEVIS_TEST_P10", nom: "Devis signé (test)" } });
  const reqDevis = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeDevis.id, obligatoire: true, blocking: true, responsable: "CLIENT", destination: "ANAH", minCount: 1 } });

  const checklist1 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item1 = checklist1.requirements.find((r) => r.requirementId === reqDevis.id);
  assert(item1?.status === "MANQUANT", `l'exigence sans document est MANQUANT (trouvé ${item1?.status})`);
  assert(checklist1.blockingCount >= 1, "au moins un blocage compté (exigence bloquante non satisfaite)");
  const blocages1 = await getDocumentBlockingReasons(dossier1.id, org.id);
  assert(blocages1.some((b) => b.requirementId === reqDevis.id), "getDocumentBlockingReasons signale bien cette exigence");

  // ============================================================
  // TEST 2 - upload d'un fichier -> FOURNI, JAMAIS confondu avec VALIDE.
  // ============================================================
  console.log("\n=== TEST 2 - upload -> FOURNI (jamais VALIDE automatiquement) ===");
  const docDevis = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("devis-signe.pdf"), organisationId: org.id, typeDocumentId: typeDevis.id, requirementId: reqDevis.id, statut: "FOURNI", provenance: "COMMERCIAL", createdById: commercial.id },
  });
  const docDevisRelu = await prisma.dossierDocument.findUniqueOrThrow({ where: { id: docDevis.id } });
  assert(docDevisRelu.statut === "FOURNI", `le document lui-même reste au statut FOURNI juste après upload (trouvé ${docDevisRelu.statut})`);
  const checklist2 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item2 = checklist2.requirements.find((r) => r.requirementId === reqDevis.id);
  assert(item2?.status === "A_VERIFIER", `un document juste uploadé (FOURNI) fait passer l'exigence à A_VERIFIER, JAMAIS directement VALIDE (trouvé ${item2?.status})`);

  // ============================================================
  // TEST 3 - validation -> exigence satisfaite, audit obligatoire renseigné.
  // ============================================================
  console.log("\n=== TEST 3 - validation -> exigence satisfaite ===");
  await prisma.dossierDocument.update({ where: { id: docDevis.id }, data: { statut: "VALIDE", validatedById: administratif.id, validatedAt: new Date(), validationComment: "Conforme." } });
  const checklist3 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item3 = checklist3.requirements.find((r) => r.requirementId === reqDevis.id);
  assert(item3?.status === "VALIDE", `après validation, l'exigence est VALIDE (trouvé ${item3?.status})`);
  assert(checklist3.completionPct === 100, `completionPct = 100% (une seule exigence obligatoire, satisfaite) - trouvé ${checklist3.completionPct}`);
  assert(checklist3.blockingCount === 0, "plus aucun blocage une fois le document validé");
  const docValideRelu = await prisma.dossierDocument.findUniqueOrThrow({ where: { id: docDevis.id } });
  assert(docValideRelu.validatedById === administratif.id && docValideRelu.validatedAt != null, "l'audit de validation (qui/quand) est bien renseigné");

  // ============================================================
  // TEST 4 - refus -> redevient bloquant, motif obligatoire tracé.
  // ============================================================
  console.log("\n=== TEST 4 - refus -> redevient bloquant ===");
  const typeRefus = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_REFUS_TEST_P10", nom: "Pièce à refuser (test)" } });
  const reqRefus = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeRefus.id, obligatoire: true, blocking: true, responsable: "CLIENT" } });
  const docRefus = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("piece-illisible.pdf"), organisationId: org.id, typeDocumentId: typeRefus.id, requirementId: reqRefus.id, statut: "FOURNI", provenance: "COMMERCIAL", createdById: commercial.id },
  });
  await prisma.dossierDocument.update({ where: { id: docRefus.id }, data: { statut: "REFUSE", validatedById: administratif.id, validatedAt: new Date(), rejectionReason: "Photo illisible." } });
  const checklist4 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item4 = checklist4.requirements.find((r) => r.requirementId === reqRefus.id);
  assert(item4?.status === "REFUSE", `document refusé -> exigence REFUSE (trouvé ${item4?.status})`);
  const blocages4 = await getDocumentBlockingReasons(dossier1.id, org.id);
  assert(blocages4.some((b) => b.requirementId === reqRefus.id), "le refus fait réapparaître le blocage");
  const docRefusRelu = await prisma.dossierDocument.findUniqueOrThrow({ where: { id: docRefus.id } });
  assert(docRefusRelu.rejectionReason === "Photo illisible.", "le motif de refus est tracé");

  // ============================================================
  // TEST 5 - remplacement : l'ancien devient REMPLACE, JAMAIS supprimé ; le
  // nouveau repart à FOURNI (jamais VALIDE automatiquement par reprise de
  // l'ancien statut).
  // ============================================================
  console.log("\n=== TEST 5 - remplacement -> ancien REMPLACE (conservé), nouveau FOURNI ===");
  const docDevisV2 = await prisma.dossierDocument.create({
    data: {
      dossierId: dossier1.id, type: "AUTRE", ...fakeFile("devis-signe-v2.pdf"), organisationId: org.id, typeDocumentId: typeDevis.id, requirementId: reqDevis.id,
      statut: "FOURNI", provenance: "COMMERCIAL", createdById: commercial.id, replacesId: docDevis.id, version: docDevis.version + 1,
    },
  });
  await prisma.dossierDocument.update({ where: { id: docDevis.id }, data: { statut: "REMPLACE" } });

  const docDevisAncienRelu = await prisma.dossierDocument.findUniqueOrThrow({ where: { id: docDevis.id } });
  assert(docDevisAncienRelu.statut === "REMPLACE", "l'ancien document passe au statut REMPLACE");
  const nbDocsDevisTotal = await prisma.dossierDocument.count({ where: { requirementId: reqDevis.id } });
  assert(nbDocsDevisTotal === 2, `l'ancien document existe TOUJOURS en base, jamais supprimé (trouvé ${nbDocsDevisTotal} documents pour cette exigence)`);
  const checklist5 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item5 = checklist5.requirements.find((r) => r.requirementId === reqDevis.id);
  assert(item5?.status === "A_VERIFIER", `après remplacement, tant que la nouvelle version n'est pas validée, l'exigence redevient A_VERIFIER, JAMAIS VALIDE par reprise de l'ancien statut (trouvé ${item5?.status})`);
  assert(item5?.providedDocuments.length === 2, "les deux versions (REMPLACE + FOURNI) restent visibles dans providedDocuments");
  assert(docDevisV2.replacesId === docDevis.id, "le nouveau document référence bien l'ancien via replacesId");

  // ============================================================
  // TEST 6 - expiration dynamique (jamais de cron) : un document VALIDE
  // dont la date d'expiration est dépassée devient EXPIRE automatiquement.
  // ============================================================
  console.log("\n=== TEST 6 - expiration dynamique -> EXPIRE ===");
  const typeExpire = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_EXPIRABLE_TEST_P10", nom: "Pièce expirable (test)" } });
  const reqExpire = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeExpire.id, obligatoire: true, blocking: false, responsable: "CLIENT", validiteJours: 30 } });
  const hier = new Date(Date.now() - 24 * 3_600_000);
  const docExpire = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("piece-expiree.pdf"), organisationId: org.id, typeDocumentId: typeExpire.id, requirementId: reqExpire.id, statut: "VALIDE", validatedById: administratif.id, validatedAt: new Date(), dateExpiration: hier, provenance: "COMMERCIAL", createdById: commercial.id },
  });
  assert(isDocumentExpired({ dateExpiration: docExpire.dateExpiration }) === true, "isDocumentExpired() détecte directement l'expiration");
  const checklist6 = await getDocumentChecklistForDossier(dossier1.id, org.id);
  const item6 = checklist6.requirements.find((r) => r.requirementId === reqExpire.id);
  assert(item6?.status === "EXPIRE", `un document VALIDE mais expiré redevient EXPIRE dans la checklist, sans cron (trouvé ${item6?.status})`);

  // ============================================================
  // TEST 7/8 - anti-fuite des packages : une pièce sensible (identité/
  // fiscal) n'est JAMAIS incluse dans un package CEE ni sous-traitant, même
  // si l'exigence est (par erreur) rattachée à cette destination.
  // ============================================================
  console.log("\n=== TEST 7/8 - profils package CEE / sous-traitant excluent les pièces sensibles ===");
  const typeSensible = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "AVIS_IMPOSITION", nom: "Avis d'imposition (test)" } });
  assert(isSensitiveTypeDocumentCode("AVIS_IMPOSITION") === true, "AVIS_IMPOSITION est bien un code sensible (liste fermée)");

  const reqSensibleCee = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeSensible.id, obligatoire: true, responsable: "CLIENT", destination: "CEE" } });
  const docSensibleCee = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("avis-imposition.pdf"), organisationId: org.id, typeDocumentId: typeSensible.id, requirementId: reqSensibleCee.id, statut: "VALIDE", validatedById: administratif.id, validatedAt: new Date(), provenance: "COMMERCIAL", createdById: commercial.id },
  });
  const previewCee = await buildTransmissionPackagePreview({ dossierId: dossier1.id, organisationId: org.id, destination: "CEE" });
  assert(!previewCee.included.some((d) => d.dossierDocumentId === docSensibleCee.id), "le profil CEE n'inclut jamais l'avis d'imposition (pièce sensible)");
  assert(previewCee.excluded.some((d) => d.dossierDocumentId === docSensibleCee.id), "l'exclusion est explicite dans la preview (jamais silencieuse)");

  const reqSensibleSousTraitant = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeSensible.id, obligatoire: true, responsable: "CLIENT", destination: "SOUS_TRAITANT" } });
  const docSensibleSousTraitant = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("avis-imposition-2.pdf"), organisationId: org.id, typeDocumentId: typeSensible.id, requirementId: reqSensibleSousTraitant.id, statut: "VALIDE", validatedById: administratif.id, validatedAt: new Date(), provenance: "COMMERCIAL", createdById: commercial.id },
  });
  const previewSousTraitant = await buildTransmissionPackagePreview({ dossierId: dossier1.id, organisationId: org.id, destination: "SOUS_TRAITANT" });
  assert(!previewSousTraitant.included.some((d) => d.dossierDocumentId === docSensibleSousTraitant.id), "le profil sous-traitant n'inclut jamais l'avis d'imposition (pièce sensible)");

  // ============================================================
  // TEST 9/10 - package = snapshot figé au moment T (jamais modifié après
  // coup) ; isTransmissionPackageStale() détecte le décalage a posteriori.
  // ============================================================
  console.log("\n=== TEST 9/10 - snapshot figé + isTransmissionPackageStale() ===");
  const typeSnapshot = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_SNAPSHOT_TEST_P10", nom: "Pièce snapshot (test)" } });
  const reqSnapshot = await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeSnapshot.id, obligatoire: true, responsable: "CLIENT", destination: "ANAH" } });
  const docSnapshot = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("piece-snapshot-v1.pdf"), organisationId: org.id, typeDocumentId: typeSnapshot.id, requirementId: reqSnapshot.id, statut: "VALIDE", validatedById: administratif.id, validatedAt: new Date(), provenance: "COMMERCIAL", createdById: commercial.id },
  });

  const packageId = await createTransmissionPackage({ dossierId: dossier1.id, organisationId: org.id, destination: "ANAH", destinationName: "ANAH départementale test", comment: null, createdById: administratif.id });
  const packageAvant = await prisma.transmissionPackage.findUniqueOrThrow({ where: { id: packageId } });
  const snapshotAvant = packageAvant.snapshot as { included: { dossierDocumentId: string; version: number }[] };
  assert(snapshotAvant.included.some((d) => d.dossierDocumentId === docSnapshot.id && d.version === 1), "le snapshot du package contient bien la v1 du document au moment de la création");

  const staleAvant = await isTransmissionPackageStale(packageId, org.id);
  assert(staleAvant === false, "le package n'est pas obsolète tant que le document inclus n'a pas été remplacé");

  const docSnapshotV2 = await prisma.dossierDocument.create({
    data: { dossierId: dossier1.id, type: "AUTRE", ...fakeFile("piece-snapshot-v2.pdf"), organisationId: org.id, typeDocumentId: typeSnapshot.id, requirementId: reqSnapshot.id, statut: "FOURNI", provenance: "COMMERCIAL", createdById: commercial.id, replacesId: docSnapshot.id, version: docSnapshot.version + 1 },
  });
  await prisma.dossierDocument.update({ where: { id: docSnapshot.id }, data: { statut: "REMPLACE" } });
  void docSnapshotV2;

  const packageApres = await prisma.transmissionPackage.findUniqueOrThrow({ where: { id: packageId } });
  const snapshotApres = packageApres.snapshot as { included: { dossierDocumentId: string; version: number }[] };
  assert(JSON.stringify(snapshotApres) === JSON.stringify(snapshotAvant), "le snapshot du package historique reste IDENTIQUE après remplacement du document - jamais modifié rétroactivement");

  const staleApres = await isTransmissionPackageStale(packageId, org.id);
  assert(staleApres === true, "isTransmissionPackageStale() détecte l'obsolescence une fois le document remplacé");

  // ============================================================
  // TEST 11 - cloisonnement multi-tenant : aucun document ni package
  // inter-tenant, y compris via un accès direct par id.
  // ============================================================
  console.log("\n=== TEST 11 - cloisonnement multi-tenant documents/packages ===");
  const orgB = await prisma.organisation.create({ data: { nom: "Test Documents P10 - Org B", slug: `test-documents-p10-b-${Date.now()}` } });
  const clientB = await prisma.client.create({ data: { organisationId: orgB.id, prenom: "Org", nom: "B" } });
  const dossierB = await prisma.dossier.create({ data: { reference: `TEST-P10-B-${Math.random().toString(36).slice(2, 8)}`, clientId: clientB.id, organisationId: orgB.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 500_000 } });
  const typeB = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgB.id, code: "PIECE_ORG_B_TEST_P10", nom: "Pièce org B (test)" } });
  const docOrgB = await prisma.dossierDocument.create({ data: { dossierId: dossierB.id, type: "AUTRE", ...fakeFile("piece-org-b.pdf"), organisationId: orgB.id, typeDocumentId: typeB.id, statut: "VALIDE", provenance: "COMMERCIAL", createdById: null } });

  const accesCroise = await prisma.dossierDocument.findFirst({ where: { id: docOrgB.id, dossier: { organisationId: org.id } } });
  assert(accesCroise === null, "un document de l'org B est introuvable via un chemin scopé à l'org A (protection IDOR)");

  let checklistOrgBLeveErreur = false;
  try {
    await getDocumentChecklistForDossier(dossierB.id, org.id);
  } catch {
    checklistOrgBLeveErreur = true;
  }
  assert(checklistOrgBLeveErreur, "getDocumentChecklistForDossier refuse un dossier d'une autre organisation (jamais de checklist inter-tenant)");

  // ============================================================
  // TEST 12 - permissions : seuls ADMIN/ADMINISTRATIF/COMPTA voient les
  // pièces sensibles ; COMMERCIAL voit qu'une pièce existe mais pas son
  // contenu sensible.
  // ============================================================
  console.log("\n=== TEST 12 - permission VIEW_SENSITIVE_DOCUMENTS ===");
  assert(hasPermission(ctxCommercial, "VIEW_DOCUMENTS") === true, "COMMERCIAL peut voir qu'une pièce existe (VIEW_DOCUMENTS)");
  assert(hasPermission(ctxCommercial, "VIEW_SENSITIVE_DOCUMENTS") === false, "COMMERCIAL n'a PAS accès aux pièces sensibles (identité/fiscal)");
  assert(hasPermission(ctxAdministratif, "VIEW_SENSITIVE_DOCUMENTS") === true, "ADMINISTRATIF a accès aux pièces sensibles");
  assert(hasPermission(ctxCompta, "VIEW_SENSITIVE_DOCUMENTS") === true, "COMPTA a accès aux pièces sensibles");

  // ============================================================
  // TEST 13 - relance REGROUPÉE : 8 pièces manquantes côté client -> une
  // seule action/trace de relance, jamais 8.
  // ============================================================
  console.log("\n=== TEST 13 - relance regroupée (8 pièces manquantes -> 1 relance) ===");
  // Organisation dédiée : les exigences "règle interne" créées plus haut sur
  // `org` s'appliquent à TOUT dossier de cette organisation (par conception -
  // aucune n'est rattachée à une étape précise), donc une nouvelle
  // organisation isole exactement les 8 exigences de ce test.
  const orgRelance = await prisma.organisation.create({ data: { nom: "Test Documents P10 - Relance", slug: `test-documents-p10-relance-${Date.now()}` } });
  const clientRelance = await prisma.client.create({ data: { organisationId: orgRelance.id, prenom: "Test", nom: "Relance" } });
  const dossier2 = await prisma.dossier.create({ data: { reference: `TEST-P10-RELANCE-${Math.random().toString(36).slice(2, 8)}`, clientId: clientRelance.id, organisationId: orgRelance.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 800_000 } });
  for (let i = 0; i < 8; i++) {
    const t = await prisma.typeDocumentReferentiel.create({ data: { organisationId: orgRelance.id, code: `PIECE_RELANCE_${i}_TEST_P10`, nom: `Pièce relance ${i} (test)` } });
    await prisma.documentRequirement.create({ data: { organisationId: orgRelance.id, typeDocumentId: t.id, obligatoire: true, responsable: "CLIENT" } });
  }
  const relanceData = await getMissingDocumentsRelanceData(dossier2.id, orgRelance.id);
  assert(relanceData.documentsManquants.length === 8, `les 8 pièces manquantes sont bien listées en détail (trouvé ${relanceData.documentsManquants.length})`);

  await logAudit({ organisationId: orgRelance.id, userId: administratif.id, entityType: "Dossier", entityId: dossier2.id, action: "RELANCE_DOCUMENTS_DEMANDEE", metadata: { nbPieces: relanceData.documentsManquants.length } });
  const relanceDataApres = await getMissingDocumentsRelanceData(dossier2.id, orgRelance.id);
  assert(relanceDataApres.relanceCount === 1, `une seule relance journalisée pour les 8 pièces, jamais 8 (trouvé ${relanceDataApres.relanceCount})`);
  assert(relanceDataApres.lastRelanceAt != null, "la date de dernière relance est renseignée");

  // ============================================================
  // TEST 14 - blocage de fin d'étape : SEULEMENT quand cette étape précise
  // a une exigence bloquante non satisfaite, jamais toutes les étapes par
  // défaut.
  // ============================================================
  console.log("\n=== TEST 14 - blocage d'étape ciblé, jamais global par défaut ===");
  const programme = await prisma.programme.create({ data: { organisationId: org.id, nom: "Programme Test P10", code: `TEST-PROG-P10-${Date.now()}` } });
  const programmeVersion = await prisma.programmeVersion.create({ data: { programmeId: programme.id, numeroVersion: "1", publie: true } });
  const etapeBloquante = await prisma.etapeProgramme.create({ data: { programmeVersionId: programmeVersion.id, code: "ETAPE_BLOQUANTE", nom: "Étape bloquante (test)", ordre: 1 } });
  const etapeLibre = await prisma.etapeProgramme.create({ data: { programmeVersionId: programmeVersion.id, code: "ETAPE_LIBRE", nom: "Étape libre (test)", ordre: 2 } });

  const dossier3 = await prisma.dossier.create({ data: { reference: `TEST-P10-ETAPE-${Math.random().toString(36).slice(2, 8)}`, clientId: client1.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 700_000, programmeVersionId: programmeVersion.id } });
  const typeEtape = await prisma.typeDocumentReferentiel.create({ data: { organisationId: org.id, code: "PIECE_ETAPE_TEST_P10", nom: "Pièce étape (test)" } });
  await prisma.documentRequirement.create({ data: { organisationId: org.id, typeDocumentId: typeEtape.id, etapeProgrammeId: etapeBloquante.id, obligatoire: true, blocking: true, responsable: "CLIENT" } });

  const blocagesEtapeBloquante = await getBlockingReasonsForEtape(dossier3.id, etapeBloquante.id, org.id);
  assert(blocagesEtapeBloquante.length > 0, "l'étape avec exigence bloquante non satisfaite est bien bloquée");
  const blocagesEtapeLibre = await getBlockingReasonsForEtape(dossier3.id, etapeLibre.id, org.id);
  assert(blocagesEtapeLibre.length === 0, "l'étape sans exigence bloquante configurée n'est JAMAIS bloquée par défaut");

  // ============================================================
  // TEST 15 - intégration réglementaire (P7) : les exigences documentaires
  // liées à une fiche CEE proviennent de RegleReglementaireVersion, donc
  // restent celles de la version FIGÉE utilisée par le calcul officiel du
  // dossier, jamais recalculées sur "la version actuelle" du barème.
  // ============================================================
  console.log("\n=== TEST 15 - exigences documentaires réglementaires liées à la version figée du calcul ===");
  const client4 = await prisma.client.create({ data: { organisationId: org.id, prenom: "Test", nom: "Reglementaire" } });
  const dossier4 = await prisma.dossier.create({ data: { reference: `TEST-P10-REGL-${Math.random().toString(36).slice(2, 8)}`, clientId: client4.id, organisationId: org.id, typeId: dossierType.id, statutId: dossierStatus.id, montantDevisTTC: 1_200_000, dateSignatureDevis: DATE_ENGAGEMENT_DEMO } });
  const poste4 = await prisma.dossierPosteTravaux.create({ data: { dossierId: dossier4.id, type: "PAC_AIR_EAU", surfaceM2: 80 } });

  const resultatCalcul = await calculateCeeCumac({ ficheCode: "BAR-TH-171", dateEngagement: DATE_ENGAGEMENT_DEMO, inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" } });
  assert(resultatCalcul.ruleVersionId != null, "le calcul CEE aboutit bien à une version de règle figée");
  const calcul4 = await prisma.calculReglementaire.create({
    data: { organisationId: org.id, dossierId: dossier4.id, posteTravauxId: poste4.id, ruleVersionId: resultatCalcul.ruleVersionId!, type: "OFFICIEL", dateEngagement: DATE_ENGAGEMENT_DEMO, inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" }, resultat: {}, kwhCumac: resultatCalcul.kwhCumac, statutEligibilite: resultatCalcul.statutEligibilite },
  });
  await prisma.dossierPosteTravaux.update({ where: { id: poste4.id }, data: { calculReglementaireActifId: calcul4.id, ficheReglementaireCode: "BAR-TH-171" } });

  const checklist15 = await getDocumentChecklistForDossier(dossier4.id, org.id);
  const exigencesReglementaires = checklist15.requirements.filter((r) => r.sourceRequirement.kind === "REGLEMENTAIRE");
  assert(exigencesReglementaires.length > 0, "des exigences documentaires réglementaires (référentiel P10 seedé, ex. CADRE_CONTRIBUTION_CEE) apparaissent bien pour ce dossier via la version de règle figée du calcul");
  assert(exigencesReglementaires.every((r) => r.sourceRequirement.label.includes("BAR-TH-171")), "chaque exigence réglementaire référence explicitement la fiche/version dont elle provient, jamais une origine implicite");

  // --- Nettoyage ---
  const allOrgIds = [org.id, orgB.id, orgRelance.id];
  await prisma.transmissionPackageDocument.deleteMany({ where: { package: { organisationId: { in: allOrgIds } } } });
  await prisma.transmissionPackage.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.calculReglementaire.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossierDocument.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.documentRequirement.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.typeDocumentReferentiel.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossier: { organisationId: { in: allOrgIds } } } });
  await prisma.dossier.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.etapeProgramme.deleteMany({ where: { programmeVersion: { programme: { organisationId: org.id } } } });
  await prisma.programmeVersion.deleteMany({ where: { programme: { organisationId: org.id } } });
  await prisma.programme.deleteMany({ where: { organisationId: org.id } });
  await prisma.client.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.auditLog.deleteMany({ where: { organisationId: { in: allOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, administratif.id, commercial.id, compta.id] } } });
  await prisma.organisation.delete({ where: { id: orgB.id } });
  await prisma.organisation.delete({ where: { id: orgRelance.id } });
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
