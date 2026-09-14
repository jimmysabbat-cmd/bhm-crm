import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { readDocumentFile } from "../src/lib/documents";
import {
  getFacturesForDossier,
  getPostesFacturablesDonneurOrdre,
  getMissionsFacturablesSousTraitant,
  getFacturesForSousTraitant,
  getFacturesSousTraitantAValider,
} from "../src/lib/facturation/access";
import { getFacturesForDonneurOrdre } from "../src/lib/donneurs-ordre/access";
import { calculateForecastCosts, calculateActualCosts, calculateContractualRevenue } from "../src/lib/financial-engine";
import {
  creerFactureDonneurOrdre,
  emettreFactureDonneurOrdre,
  validerFactureSousTraitant,
  refuserFactureSousTraitant,
  deposerFactureSousTraitant,
  ajouterReglementFacture,
  supprimerReglementFacture,
  creerFactureManuelle,
  transmettreFacture,
  changerStatutFacture,
} from "../src/lib/facturation/mutations";
import type { UserContext } from "../src/lib/authz";

// ============================================================
// P16 - tests bout-en-bout de la facturation DONNEUR_ORDRE + SOUS_TRAITANT.
// ATTENTION ABSOLUE vérifiée ici : aucun encaissement/paiement de facture
// n'est jamais compté deux fois par le moteur financier central (cf. audit
// P6 dans financial-engine.ts) ; isolation tenant/partenaire stricte.
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

function ctxFor(user: { id: string; organisationId: string; role: string; sousTraitantId: string | null; donneurOrdreId: string | null }): UserContext {
  return {
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role as UserContext["role"],
    permissions: [],
    sousTraitantId: user.sousTraitantId,
    donneurOrdreId: user.donneurOrdreId,
    isPlatformSuperAdmin: false,
  } as UserContext;
}

async function main() {
  const suffix = Date.now();
  const org = await prisma.organisation.create({ data: { nom: "Test P16 Facturation", slug: `test-p16-fact-${suffix}`, raisonSociale: "Test SARL", siret: "12345678900012", tva: "FR00123456789", adresse: "1 rue de Test", email: "contact@test.invalid" } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();

  const admin = await prisma.user.create({ data: { name: "Admin Facturation", email: `admin-fact-${suffix}@test.local`, password: "x", role: "ADMIN", organisationId: org.id } });

  const donneurOrdre = await prisma.donneurOrdre.create({ data: { organisationId: org.id, nom: "Test DO Facturation", contactEmail: `do-fact-${suffix}@test.local` } });
  const userDo = await prisma.user.create({ data: { name: "DO Facturation User", email: `do-fact-user-${suffix}@test.local`, password: "x", role: "DONNEUR_ORDRE", organisationId: org.id, donneurOrdreId: donneurOrdre.id } });
  const donneurOrdreAutre = await prisma.donneurOrdre.create({ data: { organisationId: org.id, nom: "Test DO Autre" } });
  const userDoAutre = await prisma.user.create({ data: { name: "DO Autre User", email: `do-autre-user-${suffix}@test.local`, password: "x", role: "DONNEUR_ORDRE", organisationId: org.id, donneurOrdreId: donneurOrdreAutre.id } });

  const sousTraitant = await prisma.sousTraitant.create({ data: { organisationId: org.id, nom: "Test ST Facturation", delaiPaiementJours: 30 } });
  const userSt = await prisma.user.create({ data: { name: "ST Facturation User", email: `st-fact-user-${suffix}@test.local`, password: "x", role: "SOUS_TRAITANT", organisationId: org.id, sousTraitantId: sousTraitant.id } });
  const sousTraitantAutre = await prisma.sousTraitant.create({ data: { organisationId: org.id, nom: "Test ST Autre" } });
  const userStAutre = await prisma.user.create({ data: { name: "ST Autre User", email: `st-autre-user-${suffix}@test.local`, password: "x", role: "SOUS_TRAITANT", organisationId: org.id, sousTraitantId: sousTraitantAutre.id } });

  const client = await prisma.client.create({ data: { organisationId: org.id, prenom: "Marc", nom: "Client", telephone: "0600000001", adresse: "2 rue du Chantier", ville: "Testville" } });
  const dossier = await prisma.dossier.create({
    data: { reference: `TEST-P16-FACT-${suffix}`, clientId: client.id, organisationId: org.id, typeId: type.id, statutId: statut.id, donneurOrdreId: donneurOrdre.id, montantDevisTTC: 600000 },
  });
  const posteITE = await prisma.dossierPosteTravaux.create({
    data: { dossierId: dossier.id, type: "ITE", surfaceM2: 100, montantDevisHTCts: 400000, montantDevisTTCCts: 420000, montantPoseSousTraitanceCts: 150000 },
  });
  const posteVMC = await prisma.dossierPosteTravaux.create({
    data: { dossierId: dossier.id, type: "VMC", montantDevisHTCts: 100000, montantDevisTTCCts: 105000 },
  });

  // --- 1. Facture donneur d'ordre : préparation, création, numérotation ---
  console.log("\n1. Facture donneur d'ordre");
  const postesAvant = await getPostesFacturablesDonneurOrdre(dossier.id, org.id);
  assert(postesAvant.length === 2 && postesAvant.every((p) => !p.dejaFacture), "2 postes facturables, aucun déjà facturé");

  await creerFactureDonneurOrdre({ organisationId: org.id, userId: admin.id, dossierId: dossier.id, posteIds: [posteITE.id], dateEcheance: new Date("2027-01-15") });

  const factureDO = await prisma.facture.findFirstOrThrow({ where: { organisationId: org.id, type: "DONNEUR_ORDRE", dossierId: dossier.id } });
  assert(factureDO.numero.startsWith("FDO-"), "Numéro généré au format FDO-ANNEE-NNNN");
  assert(factureDO.statut === "BROUILLON", "Statut initial BROUILLON");
  assert(factureDO.montantHTCts === 400000, "Montant HT = montant devis HT du poste ITE (pas de resaisie)");
  assert(factureDO.montantTVACts === Math.round(400000 * 0.05), "TVA déduite du ratio devis TTC/HT du poste (5% ici)");

  const postesApresCreation = await getPostesFacturablesDonneurOrdre(dossier.id, org.id);
  assert(postesApresCreation.find((p) => p.id === posteITE.id)?.dejaFacture === true, "Poste ITE marqué déjà facturé après création");
  assert(postesApresCreation.find((p) => p.id === posteVMC.id)?.dejaFacture === false, "Poste VMC toujours facturable");

  let doubleFacturationRejetee = false;
  try {
    await creerFactureDonneurOrdre({ organisationId: org.id, userId: admin.id, dossierId: dossier.id, posteIds: [posteITE.id], dateEcheance: null });
  } catch {
    doubleFacturationRejetee = true;
  }
  assert(doubleFacturationRejetee, "Impossible de refacturer un poste déjà sur une facture active");

  // --- 2. Émission : PDF + créance moteur financier ---
  console.log("\n2. Émission facture donneur d'ordre");
  await emettreFactureDonneurOrdre({ organisationId: org.id, userId: admin.id, factureId: factureDO.id });
  const factureDOEmise = await prisma.facture.findUniqueOrThrow({ where: { id: factureDO.id }, include: { mouvementFinancier: true } });
  assert(factureDOEmise.statut === "TRANSMISE", "Statut TRANSMISE après émission");
  assert(!!factureDOEmise.fichierPdfPath, "PDF généré et chemin enregistré");
  const pdfBuffer = await readDocumentFile(factureDOEmise.fichierPdfPath!);
  assert(pdfBuffer.length > 100, "Le PDF généré est un vrai fichier non vide");
  assert(!!factureDOEmise.mouvementFinancier, "Un MouvementFinancier de créance a été créé");
  assert(factureDOEmise.mouvementFinancier?.categorie === "ENCAISSEMENT_DONNEUR_ORDRE", "Catégorie ENCAISSEMENT_DONNEUR_ORDRE (jamais ENCAISSEMENT_CLIENT)");
  assert(factureDOEmise.mouvementFinancier?.montantPrevuCts === factureDOEmise.montantTTCCts, "Montant du mouvement = montant TTC de la facture");
  assert(factureDOEmise.mouvementFinancier?.statut === "A_RECEVOIR", "Mouvement en A_RECEVOIR tant que non réglé");

  let doubleEmissionRejetee = false;
  try {
    await emettreFactureDonneurOrdre({ organisationId: org.id, userId: admin.id, factureId: factureDO.id });
  } catch {
    doubleEmissionRejetee = true;
  }
  assert(doubleEmissionRejetee, "Impossible d'émettre deux fois la même facture (jamais deux mouvements pour une facture)");

  // --- 3. Numérotation séquentielle, sans trou, par organisation ---
  console.log("\n3. Numérotation séquentielle");
  await creerFactureDonneurOrdre({ organisationId: org.id, userId: admin.id, dossierId: dossier.id, posteIds: [posteVMC.id], dateEcheance: null });
  const factureDO2 = await prisma.facture.findFirstOrThrow({ where: { organisationId: org.id, type: "DONNEUR_ORDRE", dossierId: dossier.id, id: { not: factureDO.id } } });
  const n1 = parseInt(factureDO.numero.split("-")[2], 10);
  const n2 = parseInt(factureDO2.numero.split("-")[2], 10);
  assert(n2 === n1 + 1, "Le second numéro suit immédiatement le premier, sans trou");

  // --- 4. Lecture portail DO : statut dérivé, jamais de brouillon visible ---
  console.log("\n4. Lecture portail donneur d'ordre");
  const ctxDo = ctxFor({ id: userDo.id, organisationId: org.id, role: "DONNEUR_ORDRE", sousTraitantId: null, donneurOrdreId: donneurOrdre.id });
  const facturesVuesParDo = await getFacturesForDonneurOrdre(ctxDo);
  assert(facturesVuesParDo.length === 1, "Le DO ne voit que la facture ÉMISE, jamais le brouillon");
  assert(facturesVuesParDo[0].statut === "TRANSMISE", "Statut affiché TRANSMISE avant tout règlement");

  const ctxDoAutre = ctxFor({ id: userDoAutre.id, organisationId: org.id, role: "DONNEUR_ORDRE", sousTraitantId: null, donneurOrdreId: donneurOrdreAutre.id });
  const facturesVuesParAutreDo = await getFacturesForDonneurOrdre(ctxDoAutre);
  assert(facturesVuesParAutreDo.length === 0, "Isolation : un autre donneur d'ordre ne voit aucune facture de celui-ci");

  // --- 5. Règlements multiples : la facture peut être réglée en plusieurs fois et plusieurs modes ---
  console.log("\n5. Règlements multiples");

  let reglementAvantTransmissionRejete = false;
  try {
    await ajouterReglementFacture({ organisationId: org.id, userId: admin.id, factureId: factureDO2.id, montantCts: 1000, date: new Date(), mode: "VIREMENT", reference: null, commentaire: null });
  } catch {
    reglementAvantTransmissionRejete = true;
  }
  assert(reglementAvantTransmissionRejete, "Impossible d'ajouter un règlement tant que la facture n'a pas de mouvement lié (jamais transmise/validée)");

  await ajouterReglementFacture({ organisationId: org.id, userId: admin.id, factureId: factureDOEmise.id, montantCts: 200000, date: new Date("2027-01-05"), mode: "VIREMENT", reference: "VIR-001", commentaire: null });
  const factureApres1erReglement = await prisma.facture.findUniqueOrThrow({ where: { id: factureDOEmise.id }, include: { mouvementFinancier: true } });
  assert(factureApres1erReglement.statut === "PARTIELLEMENT_PAYEE", "1er règlement partiel (200000/420000) -> statut PARTIELLEMENT_PAYEE");
  assert(factureApres1erReglement.mouvementFinancier?.montantReelCts === 200000, "Mouvement.montantReelCts = somme des règlements (200000)");
  assert(factureApres1erReglement.mouvementFinancier?.statut === "PARTIEL", "Mouvement en PARTIEL tant que non soldé");

  await ajouterReglementFacture({ organisationId: org.id, userId: admin.id, factureId: factureDOEmise.id, montantCts: 220000, date: new Date("2027-01-20"), mode: "CHEQUE", reference: "CHQ-42", commentaire: "Solde" });
  const factureApres2eReglement = await prisma.facture.findUniqueOrThrow({ where: { id: factureDOEmise.id }, include: { mouvementFinancier: true, reglements: true } });
  assert(factureApres2eReglement.statut === "PAYEE", "2e règlement (220000) porte le total à 420000 = montant TTC -> PAYEE");
  assert(factureApres2eReglement.mouvementFinancier?.montantReelCts === 420000, "Mouvement.montantReelCts = somme exacte des 2 règlements (jamais recréé, un seul mouvement)");
  assert(factureApres2eReglement.mouvementFinancier?.statut === "RECU", "Mouvement soldé -> RECU");
  assert(factureApres2eReglement.reglements.length === 2, "2 lignes de règlement distinctes conservées (audit détaillé)");

  const facturesVuesParDoApresPaiement = await getFacturesForDonneurOrdre(ctxDo);
  assert(facturesVuesParDoApresPaiement.find((f) => f.id === factureDO.id)?.statut === "PAYEE", "Le portail DO reflète PAYEE (statut désormais autoritaire, plus de dérivation en lecture)");
  assert(facturesVuesParDoApresPaiement.find((f) => f.id === factureDO.id)?.resteCts === 0, "Reste dû = 0 après solde complet");

  // Suppression d'un règlement : recalcul, jamais un statut figé
  const idReglementCheque = factureApres2eReglement.reglements.find((r) => r.mode === "CHEQUE")!.id;
  await supprimerReglementFacture({ organisationId: org.id, userId: admin.id, reglementId: idReglementCheque });
  const factureApresSuppression = await prisma.facture.findUniqueOrThrow({ where: { id: factureDOEmise.id }, include: { mouvementFinancier: true } });
  assert(factureApresSuppression.statut === "PARTIELLEMENT_PAYEE", "Suppression du chèque -> repasse PARTIELLEMENT_PAYEE (recalcul, jamais une resaisie)");
  assert(factureApresSuppression.mouvementFinancier?.montantReelCts === 200000, "Le mouvement retombe exactement à 200000 (somme des règlements restants)");

  // Non double comptage côté entrées P6 : la facture CLIENT/DO n'ajoute jamais le CA une 2e fois (CA reste Dossier.montantDevisTTC, jamais recalculé depuis une Facture)
  const caContractuelApresFacturation = await calculateContractualRevenue(dossier.id);
  assert(caContractuelApresFacturation.amountCts === 600000, "Le CA contractuel reste Dossier.montantDevisTTC (600000), jamais modifié par la création/le règlement d'une facture");

  // --- 6. Facture sous-traitant : dépôt, validation, dette fournisseur ---
  console.log("\n6. Facture sous-traitant");
  const missionTerminee = await prisma.transmissionPackage.create({
    data: {
      organisationId: org.id,
      dossierId: dossier.id,
      destinationType: "SOUS_TRAITANT",
      destinationSousTraitantId: sousTraitant.id,
      posteTravauxId: posteVMC.id,
      status: "TERMINEE",
      prixConvenuCts: 80000,
      snapshot: {},
    },
  });

  const ctxSt = ctxFor({ id: userSt.id, organisationId: org.id, role: "SOUS_TRAITANT", sousTraitantId: sousTraitant.id, donneurOrdreId: null });
  const missionsFacturablesAvant = await getMissionsFacturablesSousTraitant(ctxSt);
  assert(missionsFacturablesAvant.length === 1 && missionsFacturablesAvant[0].factureExistante === null, "Mission terminée facturable, aucune facture existante");

  await deposerFactureSousTraitant({
    organisationId: org.id,
    userId: userSt.id,
    sousTraitantId: sousTraitant.id,
    packageId: missionTerminee.id,
    numero: "ST-FACT-001",
    montantHTCts: 80000,
    tauxTVA: 0.2,
    file: null,
  });
  const factureST = await prisma.facture.findFirstOrThrow({ where: { organisationId: org.id, type: "SOUS_TRAITANT", sousTraitantId: sousTraitant.id } });
  assert(factureST.numero === "ST-FACT-001", "Le numéro est la référence libre du sous-traitant, jamais généré par nous");
  assert(factureST.statut === "RECUE" && factureST.validatedAt === null, "Déposée = RECUE mais NON validée (aucun paiement automatique)");
  assert(factureST.montantTTCCts === 96000, "Montant TTC calculé depuis le HT saisi (800€ HT + 20%)");

  let doubleDepotRejete = false;
  try {
    await deposerFactureSousTraitant({
      organisationId: org.id,
      userId: userSt.id,
      sousTraitantId: sousTraitant.id,
      packageId: missionTerminee.id,
      numero: "ST-FACT-002",
      montantHTCts: 80000,
      tauxTVA: 0.2,
      file: null,
    });
  } catch {
    doubleDepotRejete = true;
  }
  assert(doubleDepotRejete, "Impossible de déposer deux factures actives sur le même poste");

  const ctxStAutre = ctxFor({ id: userStAutre.id, organisationId: org.id, role: "SOUS_TRAITANT", sousTraitantId: sousTraitantAutre.id, donneurOrdreId: null });
  const facturesVuesParAutreSt = await getFacturesForSousTraitant(ctxStAutre);
  assert(facturesVuesParAutreSt.length === 0, "Isolation : un autre sous-traitant ne voit aucune facture de celui-ci");

  const aValiderAvant = await getFacturesSousTraitantAValider(org.id);
  assert(aValiderAvant.some((f) => f.id === factureST.id), "La facture déposée apparaît dans la file de validation interne");

  const coutsPrevusAvantValidation = await calculateForecastCosts(dossier.id);
  const coutsReelsAvantValidation = await calculateActualCosts(dossier.id);

  await validerFactureSousTraitant({ organisationId: org.id, userId: admin.id, factureId: factureST.id });
  const factureSTValidee = await prisma.facture.findUniqueOrThrow({ where: { id: factureST.id }, include: { mouvementFinancier: true } });
  assert(!!factureSTValidee.validatedAt, "validatedAt renseigné après validation interne");
  assert(factureSTValidee.mouvementFinancier?.categorie === "PAIEMENT_SOUS_TRAITANT", "Dette fournisseur créée en PAIEMENT_SOUS_TRAITANT");
  assert(factureSTValidee.mouvementFinancier?.statut === "A_PAYER", "Mouvement en A_PAYER (pas encore réglé)");

  const aValiderApres = await getFacturesSousTraitantAValider(org.id);
  assert(!aValiderApres.some((f) => f.id === factureST.id), "Facture retirée de la file une fois validée");

  let doubleValidationRejetee = false;
  try {
    await validerFactureSousTraitant({ organisationId: org.id, userId: admin.id, factureId: factureST.id });
  } catch {
    doubleValidationRejetee = true;
  }
  assert(doubleValidationRejetee, "Impossible de valider deux fois la même facture (jamais deux dettes pour un même paiement)");

  // --- 7. Pas de double comptage avec le moteur financier P6 ---
  console.log("\n7. Non double comptage P6 (audit préalable)");
  const coutsPrevusApresValidation = await calculateForecastCosts(dossier.id);
  assert(
    coutsPrevusApresValidation.totalCts === coutsPrevusAvantValidation.totalCts,
    "Les coûts prévisionnels ne bougent PAS à la validation (PAIEMENT_SOUS_TRAITANT déjà exclu, coût déjà porté par le poste)"
  );
  const coutsReelsApresValidationNonPayee = await calculateActualCosts(dossier.id);
  assert(
    coutsReelsApresValidationNonPayee.totalCts === coutsReelsAvantValidation.totalCts,
    "Les coûts réels ne bougent PAS tant que le mouvement n'est pas marqué PAYE/PARTIEL (A_PAYER seul ne compte pas)"
  );

  await ajouterReglementFacture({ organisationId: org.id, userId: admin.id, factureId: factureSTValidee.id, montantCts: 96000, date: new Date(), mode: "VIREMENT", reference: null, commentaire: "Paiement fournisseur" });
  const coutsReelsApresPaiement = await calculateActualCosts(dossier.id);
  assert(coutsReelsApresPaiement.totalCts === coutsReelsAvantValidation.totalCts + 96000, "Coût réel augmente d'exactement une fois le montant payé (via règlement), jamais deux fois");
  const factureSTPayee = await prisma.facture.findUniqueOrThrow({ where: { id: factureSTValidee.id } });
  assert(factureSTPayee.statut === "PAYEE", "Facture ST -> PAYEE une fois le règlement fournisseur enregistré");

  // --- 8. Refus d'une facture ST déposée (avant validation) ---
  console.log("\n8. Refus facture sous-traitant");
  const posteRefus = await prisma.dossierPosteTravaux.create({ data: { dossierId: dossier.id, type: "COMBLES", montantDevisHTCts: 50000 } });
  const missionRefus = await prisma.transmissionPackage.create({
    data: { organisationId: org.id, dossierId: dossier.id, destinationType: "SOUS_TRAITANT", destinationSousTraitantId: sousTraitant.id, posteTravauxId: posteRefus.id, status: "TERMINEE", snapshot: {} },
  });
  await deposerFactureSousTraitant({ organisationId: org.id, userId: userSt.id, sousTraitantId: sousTraitant.id, packageId: missionRefus.id, numero: "ST-FACT-REFUS", montantHTCts: 30000, tauxTVA: 0.2, file: null });
  const factureARefuser = await prisma.facture.findFirstOrThrow({ where: { organisationId: org.id, numero: "ST-FACT-REFUS" } });
  await refuserFactureSousTraitant({ organisationId: org.id, userId: admin.id, factureId: factureARefuser.id, motif: "Montant incorrect" });
  const factureRefusee = await prisma.facture.findUniqueOrThrow({ where: { id: factureARefuser.id } });
  assert(factureRefusee.statut === "REFUSEE", "Statut REFUSEE après refus");
  assert(factureRefusee.mouvementFinancierId === null, "Aucun mouvement créé pour une facture refusée (jamais de dette pour un refus)");
  const aValiderSansRefusee = await getFacturesSousTraitantAValider(org.id);
  assert(!aValiderSansRefusee.some((f) => f.id === factureARefuser.id), "Une facture refusée disparaît de la file de validation");

  // --- 9. Dépôt manuel MVP (CLIENT) + reprise d'une facture déjà réglée ---
  console.log("\n9. Dépôt manuel + reprise");
  const factureClient = await creerFactureManuelle({
    organisationId: org.id,
    userId: admin.id,
    dossierId: dossier.id,
    type: "CLIENT",
    posteTravauxId: null,
    sousTraitantId: null,
    numero: "CLI-2027-001",
    dateFacture: new Date("2027-02-01"),
    dateEcheance: new Date("2027-03-01"),
    montantHTCts: 50000,
    tauxTVA: 0.2,
    commentaire: "Acompte client",
    file: null,
    statutInitial: null,
    montantDejaRegleCts: 0,
    reglementDate: null,
    reglementMode: null,
    reglementReference: null,
  });
  assert(factureClient.type === "CLIENT" && factureClient.statut === "BROUILLON", "Facture CLIENT créée en BROUILLON, numéro saisi manuellement");
  assert(factureClient.mouvementFinancierId === null, "Aucun mouvement tant que non transmise");

  await transmettreFacture({ organisationId: org.id, userId: admin.id, factureId: factureClient.id, destinataire: "Client final" });
  const factureClientTransmise = await prisma.facture.findUniqueOrThrow({ where: { id: factureClient.id }, include: { mouvementFinancier: true, transmissions: true } });
  assert(factureClientTransmise.statut === "TRANSMISE", "Transmission -> TRANSMISE");
  assert(factureClientTransmise.mouvementFinancier?.categorie === "ENCAISSEMENT_CLIENT", "Créance CLIENT en ENCAISSEMENT_CLIENT (flux client existant, jamais un nouveau flux parallèle)");
  assert(factureClientTransmise.transmissions.length === 1, "Historique de transmission tracé (1 ligne)");

  // Reprise : une facture déjà envoyée et intégralement payée avant l'usage du CRM, saisie en une fois
  const factureReprise = await creerFactureManuelle({
    organisationId: org.id,
    userId: admin.id,
    dossierId: dossier.id,
    type: "CLIENT",
    posteTravauxId: null,
    sousTraitantId: null,
    numero: "CLI-2026-REPRISE",
    dateFacture: new Date("2026-06-01"),
    dateEcheance: new Date("2026-07-01"),
    montantHTCts: 100000,
    tauxTVA: 0.2,
    commentaire: "Chantier terminé il y a 2 mois, déjà réglé",
    file: null,
    statutInitial: "PAYEE",
    montantDejaRegleCts: 120000,
    reglementDate: new Date("2026-07-10"),
    reglementMode: "VIREMENT",
    reglementReference: "REPRISE-1",
  });
  const factureRepriseVerif = await prisma.facture.findUniqueOrThrow({ where: { id: factureReprise.id }, include: { mouvementFinancier: true, reglements: true } });
  assert(factureRepriseVerif.statut === "PAYEE", "Reprise directe en PAYEE, sans rejouer transmission/attente (workflow non artificiellement répété)");
  assert(factureRepriseVerif.reglements.length === 1 && factureRepriseVerif.reglements[0].montantCts === 120000, "Le règlement historique est réellement enregistré (pas juste une étiquette de statut)");
  assert(factureRepriseVerif.mouvementFinancier?.montantReelCts === 120000, "Le moteur financier P6 voit cet encaissement historique comme n'importe quel autre");

  // Changement manuel de statut : ne touche jamais le mouvement lié
  await changerStatutFacture({ organisationId: org.id, userId: admin.id, factureId: factureClientTransmise.id, statut: "LITIGE" });
  const factureApresChangementManuel = await prisma.facture.findUniqueOrThrow({ where: { id: factureClientTransmise.id }, include: { mouvementFinancier: true } });
  assert(factureApresChangementManuel.statut === "LITIGE", "Changement manuel de statut appliqué");
  assert(!factureApresChangementManuel.mouvementFinancier?.montantReelCts, "Le changement manuel de statut ne modifie JAMAIS le mouvement financier (seuls les règlements le peuvent)");

  const dossierRow = await getFacturesForDossier(dossier.id, org.id);
  assert(dossierRow.length === 6, "Le cockpit dossier voit les 6 factures (2 DO + 2 ST + 2 CLIENT)");

  console.log(`\n${passed} OK / ${failed} FAIL`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
