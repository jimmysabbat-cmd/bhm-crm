import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildStudyContext, runDossierStudy, computeStudyInputHash, isStudyStale } from "../src/lib/etude/engine";
import { calculateCustomerRemainingCharge, calculateScenarioMargin } from "../src/lib/etude/scenarios";
import { calculateCeeCumac } from "../src/lib/reglementaire/engine";
import { hasPermission, canAccessDossierStudy, type UserContext } from "../src/lib/authz";
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
  // TEST 1 - reste à charge : les aides financent le CA, jamais additionnées
  // (section 34 du prompt P8). Cas verbatim de la spec : devis 25 000 €,
  // ANAH 18 000 €, CEE 2 000 € -> reste = 5 000 €, JAMAIS 50 000 €.
  // ============================================================
  console.log("\n=== TEST 1 - reste à charge client (anti double-comptage) ===");
  const resteACharge = calculateCustomerRemainingCharge({
    caContractuelCts: 2_500_000,
    aides: [{ montantCts: 1_800_000 }, { montantCts: 200_000 }],
  });
  assert(resteACharge === 500_000, `reste à charge = 5 000 € (trouvé ${resteACharge / 100} €)`);
  assert(resteACharge !== 5_000_000, "reste à charge n'est JAMAIS 50 000 € (aides jamais additionnées au CA)");

  const resteAChargeAidesSuperieures = calculateCustomerRemainingCharge({
    caContractuelCts: 1_000_000,
    aides: [{ montantCts: 1_500_000 }],
  });
  assert(resteAChargeAidesSuperieures === 0, "reste à charge plafonné à 0 (jamais négatif) quand les aides dépassent le CA");

  // ============================================================
  // TEST 2 - marge : 25 000 € CA / 15 000 € coûts -> 10 000 € / 40 %
  // ============================================================
  console.log("\n=== TEST 2 - marge prévisionnelle ===");
  const margeFiable = calculateScenarioMargin({ caCts: 2_500_000, coutsCts: 1_500_000, costStatus: "COMPLETE", caConfidence: "HIGH" });
  assert(margeFiable.margeCts === 1_000_000, `marge = 10 000 € (trouvé ${margeFiable.margeCts / 100} €)`);
  assert(margeFiable.margePct === 40, `marge = 40 % (trouvé ${margeFiable.margePct} %)`);
  assert(margeFiable.confidence === "FIABLE", "confiance FIABLE quand CA connu et coûts complets");

  // ============================================================
  // TEST 3 - coûts incomplets -> ESTIMATION_INCOMPLETE, jamais présentée
  // comme une marge certaine
  // ============================================================
  console.log("\n=== TEST 3 - marge sur coûts incomplets ===");
  const margeIncomplete = calculateScenarioMargin({ caCts: 2_500_000, coutsCts: 500_000, costStatus: "INCOMPLETE", caConfidence: "HIGH" });
  assert(margeIncomplete.confidence === "ESTIMATION_INCOMPLETE", "confiance ESTIMATION_INCOMPLETE quand les coûts sont incomplets");
  assert(margeIncomplete.missingFields.includes("coutsPrevus"), "missingFields signale coutsPrevus");

  const margeNonCalculable = calculateScenarioMargin({ caCts: 0, coutsCts: 0, costStatus: "COMPLETE", caConfidence: "LOW" });
  assert(margeNonCalculable.confidence === "NON_CALCULABLE", "confiance NON_CALCULABLE quand le CA est inconnu (jamais un chiffre inventé)");

  // ============================================================
  // Fixtures communes pour les tests d'intégration (4 à 11) : une
  // organisation, un admin, un client, un dossier avec un poste PAC_AIR_EAU
  // migré (BAR-TH-171), toutes les données réglementaires renseignées.
  // ============================================================
  const org = await prisma.organisation.create({ data: { nom: "Test Etude P8", slug: `test-etude-p8-${Date.now()}` } });
  const dossierType = await prisma.dossierType.findFirstOrThrow();
  const dossierStatut = await prisma.dossierStatus.findFirstOrThrow();
  const admin = await prisma.user.create({
    data: { organisationId: org.id, email: `test-etude-admin-${Date.now()}@example.com`, name: "Test Admin", role: "ADMIN", actif: true, password: "test-not-used" },
  });
  const commercial = await prisma.user.create({
    data: { organisationId: org.id, email: `test-etude-commercial-${Date.now()}@example.com`, name: "Test Commercial", role: "COMMERCIAL", actif: true, password: "test-not-used" },
  });
  const autreCommercial = await prisma.user.create({
    data: { organisationId: org.id, email: `test-etude-commercial2-${Date.now()}@example.com`, name: "Autre Commercial", role: "COMMERCIAL", actif: true, password: "test-not-used" },
  });
  const client = await prisma.client.create({
    data: { prenom: "Test", nom: "Etude", organisationId: org.id, zoneClimatique: "H1", precarite: "INTERMEDIAIRE" },
  });
  const dossier = await prisma.dossier.create({
    data: {
      reference: `TESTETUDE-${Date.now()}`,
      clientId: client.id,
      organisationId: org.id,
      typeId: dossierType.id,
      statutId: dossierStatut.id,
      montantDevisTTC: 2_500_000,
      montantAideMPR: 500_000,
      dateSignatureDevis: new Date("2026-06-15"),
      createdById: commercial.id,
    },
  });
  const poste = await prisma.dossierPosteTravaux.create({
    data: { dossierId: dossier.id, type: "PAC_AIR_EAU", surfaceM2: 80, montantMaterielTTCCts: 1_500_000 },
  });
  const delegataire1 = await prisma.delegataireCee.create({ data: { nom: "Test Délégataire 1", actif: true } });
  const delegataire2 = await prisma.delegataireCee.create({ data: { nom: "Test Délégataire 2", actif: true } });
  await prisma.tarifDelegataireCee.create({
    data: { organisationId: org.id, delegataireId: delegataire1.id, ficheCode: "BAR-TH-171", categorie: "CLASSIQUE", tauxCtsParMwhc: 7_400, dateDebut: new Date("2026-01-01"), delaiPaiementJours: 45, actif: true },
  });
  await prisma.tarifDelegataireCee.create({
    data: { organisationId: org.id, delegataireId: delegataire2.id, ficheCode: "BAR-TH-171", categorie: "CLASSIQUE", tauxCtsParMwhc: 8_100, dateDebut: new Date("2026-01-01"), delaiPaiementJours: 60, actif: true },
  });
  const cumacVersion = await prisma.regleReglementaireVersion.findFirstOrThrow({ where: { regle: { code: "BAR-TH-171" } } });
  const calculInitial = await prisma.calculReglementaire.create({
    data: {
      organisationId: org.id,
      dossierId: dossier.id,
      posteTravauxId: poste.id,
      ruleVersionId: cumacVersion.id,
      type: "OFFICIEL",
      dateEngagement: new Date("2026-06-15"),
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
      resultat: {},
      kwhCumac: 458_640,
      statutEligibilite: "ELIGIBLE_PROBABLE",
    },
  });
  await prisma.dossierPosteTravaux.update({ where: { id: poste.id }, data: { calculReglementaireActifId: calculInitial.id, ficheReglementaireCode: "BAR-TH-171" } });

  // ============================================================
  // TEST 4 - le CEE de l'étude réutilise EXACTEMENT la formule P7, jamais
  // une seconde implémentation du calcul cumac.
  // ============================================================
  console.log("\n=== TEST 4 - le moteur d'étude réutilise la formule cumac P7 (pas de doublon) ===");
  const cumacDirect = await calculateCeeCumac({ ficheCode: "BAR-TH-171", dateEngagement: new Date("2026-06-15"), inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" } });
  const etudeResult = await runDossierStudy({ organisationId: org.id, dossierId: dossier.id, mode: "SIMULATION" });
  const scenariosAvecFiche = etudeResult.scenarios.filter((s) => s.ceeKwhCumac != null);
  assert(scenariosAvecFiche.length > 0, "au moins un scénario avec un calcul CEE");
  assert(scenariosAvecFiche.every((s) => s.ceeKwhCumac === cumacDirect.kwhCumac), `tous les scénarios utilisent le kWh cumac calculé par calculateCeeCumac (${cumacDirect.kwhCumac})`);

  // ============================================================
  // TEST 5 - deux délégataires -> deux variantes de scénario avec taux/délai
  // distincts et corrects.
  // ============================================================
  console.log("\n=== TEST 5 - variantes par délégataire ===");
  assert(scenariosAvecFiche.length === 2, `2 scénarios (un par délégataire compatible) - trouvé ${scenariosAvecFiche.length}`);
  const scenarioD1 = scenariosAvecFiche.find((s) => s.delegataireId === delegataire1.id);
  const scenarioD2 = scenariosAvecFiche.find((s) => s.delegataireId === delegataire2.id);
  assert(scenarioD1 != null && scenarioD2 != null, "un scénario par délégataire (delegataire1 et delegataire2 tous deux présents)");
  if (scenarioD1 && scenarioD2) {
    const attenduD1 = Math.round((cumacDirect.kwhCumac! / 1000) * 7_400);
    const attenduD2 = Math.round((cumacDirect.kwhCumac! / 1000) * 8_100);
    assert(scenarioD1.valorisationCeeCts === attenduD1, `délégataire 1 valorisé à ${attenduD1 / 100} € (trouvé ${scenarioD1.valorisationCeeCts! / 100} €)`);
    assert(scenarioD2.valorisationCeeCts === attenduD2, `délégataire 2 valorisé à ${attenduD2 / 100} € (trouvé ${scenarioD2.valorisationCeeCts! / 100} €)`);
    assert(scenarioD1.delaiPaiementDelegataireJours === 45, "délai délégataire 1 = 45 jours");
    assert(scenarioD2.delaiPaiementDelegataireJours === 60, "délai délégataire 2 = 60 jours");
  }

  // ============================================================
  // TEST 6 - avertissement "source non vérifiée" TOUJOURS présent pour
  // BAR-TH-171 (jamais masqué, section 17/18 du prompt P8).
  // ============================================================
  console.log("\n=== TEST 6 - avertissement source réglementaire non vérifiée ===");
  for (const s of scenariosAvecFiche) {
    const fiche = s.fichesReglementaires[0];
    assert(fiche != null && fiche.confianceSource === "UNVERIFIED_SOURCE", `scénario ${s.id} : confianceSource = UNVERIFIED_SOURCE`);
    assert(fiche != null && !!fiche.avertissementSource, `scénario ${s.id} : avertissementSource renseigné`);
    assert(s.warnings.some((w) => w.toLowerCase().includes("vérifier")), `scénario ${s.id} : l'avertissement apparaît aussi dans warnings (jamais masqué)`);
  }

  // ============================================================
  // TEST 7 - appliquer le même scénario deux fois ne doit jamais dupliquer
  // de calcul réglementaire ni de mouvement financier (idempotence).
  // ============================================================
  console.log("\n=== TEST 7 - application idempotente d'un scénario ===");
  const inputHashV1 = computeStudyInputHash(etudeResult.context);
  const etude = await prisma.etudeDossier.create({
    data: {
      organisationId: org.id,
      dossierId: dossier.id,
      version: 1,
      mode: "OFFICIEL",
      inputsSnapshot: JSON.parse(JSON.stringify(etudeResult.context)),
      resultsSnapshot: JSON.parse(JSON.stringify({ scenarios: etudeResult.scenarios, recommendedScenarioLabel: etudeResult.recommendedScenarioLabel })),
      inputHash: inputHashV1,
      recommendedScenarioId: etudeResult.recommendedScenarioId,
      createdById: admin.id,
    },
  });

  async function appliquerScenarioPourTest(scenarioId: string) {
    const scenario = etudeResult.scenarios.find((s) => s.id === scenarioId)!;
    const sourceTag = `ETUDE_SCENARIO:${etude.id}:${scenarioId}`;
    const posteId = scenario.posteIds[0];
    const fiche = scenario.fichesReglementaires[0];

    const calculsExistants = await prisma.calculReglementaire.findMany({ where: { organisationId: org.id, posteTravauxId: posteId }, select: { id: true, resultat: true } });
    const calculExistant = calculsExistants.find((c) => (c.resultat as { sourceId?: string } | null)?.sourceId === sourceTag);
    const regInputs = etudeResult.context.regulatoryInputs.find((r) => r.posteId === posteId)?.inputs ?? {};
    let calculCree = false;
    const c =
      calculExistant ??
      (await prisma.calculReglementaire.create({
        data: {
          organisationId: org.id,
          dossierId: dossier.id,
          posteTravauxId: posteId,
          ruleVersionId: fiche.ruleVersionId,
          type: "OFFICIEL",
          dateEngagement: new Date("2026-06-15"),
          inputs: regInputs as Prisma.InputJsonValue,
          resultat: { sourceType: "ETUDE_SCENARIO", sourceId: sourceTag },
          kwhCumac: scenario.ceeKwhCumac,
          statutEligibilite: scenario.statutEligibilite ?? "A_CONFIRMER",
          createdById: admin.id,
        },
      }));
    if (!calculExistant) calculCree = true;
    await prisma.dossierPosteTravaux.update({ where: { id: posteId }, data: { calculReglementaireActifId: c.id } });

    let mouvementCree = false;
    if (scenario.valorisationCeeCts) {
      const tag = `${sourceTag}:CEE`;
      const existant = await prisma.mouvementFinancier.findFirst({ where: { organisationId: org.id, dossierId: dossier.id, origine: tag } });
      if (!existant) {
        await prisma.mouvementFinancier.create({
          data: { organisationId: org.id, dossierId: dossier.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", payeurType: "CEE", montantPrevuCts: scenario.valorisationCeeCts, statut: "A_RECEVOIR", origine: tag, createdById: admin.id },
        });
        mouvementCree = true;
      }
    }
    return { calculCree, mouvementCree };
  }

  const scenarioAppliqueId = scenarioD1!.id;
  const apply1 = await appliquerScenarioPourTest(scenarioAppliqueId);
  const apply2 = await appliquerScenarioPourTest(scenarioAppliqueId);
  const apply3 = await appliquerScenarioPourTest(scenarioAppliqueId);
  assert(apply1.calculCree === true, "premier appel : un CalculReglementaire est créé");
  assert(apply2.calculCree === false && apply3.calculCree === false, "appels suivants : aucun nouveau CalculReglementaire créé");
  assert(apply1.mouvementCree === true, "premier appel : un MouvementFinancier est créé");
  assert(apply2.mouvementCree === false && apply3.mouvementCree === false, "appels suivants : aucun nouveau MouvementFinancier créé");

  const tousLesCalculsDuPoste = await prisma.calculReglementaire.findMany({ where: { organisationId: org.id, posteTravauxId: poste.id }, select: { resultat: true } });
  const nbCalculsPourScenario = tousLesCalculsDuPoste.filter(
    (c) => (c.resultat as { sourceId?: string } | null)?.sourceId === `ETUDE_SCENARIO:${etude.id}:${scenarioAppliqueId}`
  ).length;
  assert(nbCalculsPourScenario === 1, `un seul CalculReglementaire marqué pour ce scénario même après 3 applications (trouvé ${nbCalculsPourScenario})`);
  const nbMouvementsPourScenario = await prisma.mouvementFinancier.count({ where: { organisationId: org.id, dossierId: dossier.id, origine: `ETUDE_SCENARIO:${etude.id}:${scenarioAppliqueId}:CEE` } });
  assert(nbMouvementsPourScenario === 1, `un seul MouvementFinancier marqué pour ce scénario même après 3 applications (trouvé ${nbMouvementsPourScenario})`);

  // ============================================================
  // TEST 8 - obsolescence : modifier une donnée pertinente après
  // enregistrement rend l'étude obsolète (hash différent), sans jamais
  // modifier l'étude déjà enregistrée.
  // ============================================================
  console.log("\n=== TEST 8 - obsolescence (isStudyStale) ===");
  const contextAvantModif = await buildStudyContext(dossier.id, org.id);
  assert(!isStudyStale(etude, contextAvantModif), "étude non obsolète juste après son enregistrement (aucune donnée pertinente n'a changé)");

  await prisma.dossier.update({ where: { id: dossier.id }, data: { montantDevisTTC: 3_000_000 } });
  const contextApresModif = await buildStudyContext(dossier.id, org.id);
  assert(isStudyStale(etude, contextApresModif), "étude obsolète après modification du montant du devis");

  const etudeRelue = await prisma.etudeDossier.findUniqueOrThrow({ where: { id: etude.id } });
  assert(etudeRelue.inputHash === inputHashV1, "l'étude enregistrée elle-même n'a PAS été modifiée par la détection d'obsolescence");
  assert(JSON.stringify(etudeRelue.resultsSnapshot) === JSON.stringify(etude.resultsSnapshot), "resultsSnapshot inchangé");

  await prisma.dossier.update({ where: { id: dossier.id }, data: { montantDevisTTC: 2_500_000 } });

  // ============================================================
  // TEST 9 - permissions : COMMERCIAL simule/voit ses propres dossiers mais
  // jamais les coûts/la marge sans VIEW_MARGIN/VIEW_INTERNAL_COSTS ; la
  // direction voit tout ; REGIE/SOUS_TRAITANT n'ont aucun accès.
  // ============================================================
  console.log("\n=== TEST 9 - permissions par rôle ===");
  const ctxAdmin: UserContext = { userId: admin.id, organisationId: org.id, role: "ADMIN" };
  const ctxCommercialProprietaire: UserContext = { userId: commercial.id, organisationId: org.id, role: "COMMERCIAL" };
  const ctxAutreCommercial: UserContext = { userId: autreCommercial.id, organisationId: org.id, role: "COMMERCIAL" };
  const ctxRegie: UserContext = { userId: "n/a", organisationId: org.id, role: "REGIE" };
  const ctxComptabilite: UserContext = { userId: "n/a", organisationId: org.id, role: "COMPTABILITE" };

  assert(hasPermission(ctxAdmin, "VIEW_STUDY") && hasPermission(ctxAdmin, "RUN_STUDY") && hasPermission(ctxAdmin, "SAVE_STUDY") && hasPermission(ctxAdmin, "APPLY_STUDY"), "ADMIN a VIEW/RUN/SAVE/APPLY_STUDY");
  assert(hasPermission(ctxAdmin, "VIEW_MARGIN") && hasPermission(ctxAdmin, "VIEW_INTERNAL_COSTS"), "ADMIN voit marge et coûts internes");

  assert(canAccessDossierStudy(ctxCommercialProprietaire, dossier), "le commercial créateur du dossier peut accéder à son étude");
  assert(!canAccessDossierStudy(ctxAutreCommercial, dossier), "un AUTRE commercial ne peut PAS accéder à l'étude de ce dossier (pas son dossier)");
  assert(!hasPermission(ctxCommercialProprietaire, "VIEW_MARGIN") && !hasPermission(ctxCommercialProprietaire, "VIEW_INTERNAL_COSTS"), "COMMERCIAL ne voit jamais la marge ni les coûts internes");
  assert(hasPermission(ctxCommercialProprietaire, "RUN_STUDY"), "COMMERCIAL peut simuler (RUN_STUDY)");
  assert(!hasPermission(ctxCommercialProprietaire, "SAVE_STUDY") && !hasPermission(ctxCommercialProprietaire, "APPLY_STUDY"), "COMMERCIAL ne peut ni enregistrer ni appliquer une étude");

  assert(!hasPermission(ctxRegie, "VIEW_STUDY"), "RÉGIE n'a aucun accès à l'étude");
  assert(hasPermission(ctxComptabilite, "VIEW_STUDY") && !hasPermission(ctxComptabilite, "RUN_STUDY"), "COMPTABILITÉ lit l'étude mais ne simule pas");

  // ============================================================
  // TEST 10 - cloisonnement multi-tenant : org A ne voit jamais les
  // études/tarifs/scénarios de org B.
  // ============================================================
  console.log("\n=== TEST 10 - cloisonnement multi-tenant ===");
  const orgB = await prisma.organisation.create({ data: { nom: "Test Etude P8 - Org B", slug: `test-etude-p8-b-${Date.now()}` } });
  const clientB = await prisma.client.create({ data: { prenom: "B", nom: "Client", organisationId: orgB.id, zoneClimatique: "H1", precarite: "INTERMEDIAIRE" } });
  const dossierB = await prisma.dossier.create({
    data: { reference: `TESTETUDE-B-${Date.now()}`, clientId: clientB.id, organisationId: orgB.id, typeId: dossierType.id, statutId: dossierStatut.id, montantDevisTTC: 1_000_000, dateSignatureDevis: new Date("2026-06-15") },
  });

  let etudeOrgBVisibleDepuisOrgA = true;
  try {
    const introuvable = await prisma.etudeDossier.findFirst({ where: { id: etude.id, organisationId: orgB.id } });
    etudeOrgBVisibleDepuisOrgA = introuvable != null;
  } catch {
    etudeOrgBVisibleDepuisOrgA = false;
  }
  assert(!etudeOrgBVisibleDepuisOrgA, "l'étude de l'org A est introuvable quand on la cherche scopée à l'org B");

  let peutConstruireContexteOrgBSurDossierOrgA = true;
  try {
    await buildStudyContext(dossier.id, orgB.id);
  } catch {
    peutConstruireContexteOrgBSurDossierOrgA = false;
  }
  assert(!peutConstruireContexteOrgBSurDossierOrgA, "buildStudyContext refuse un dossier de l'org A quand on le scope à l'org B");

  const tarifsVisiblesDepuisOrgB = await prisma.tarifDelegataireCee.findMany({ where: { organisationId: orgB.id } });
  assert(tarifsVisiblesDepuisOrgB.length === 0, "aucun tarif délégataire de l'org A n'est visible depuis l'org B");

  await prisma.dossier.delete({ where: { id: dossierB.id } });
  await prisma.client.delete({ where: { id: clientB.id } });
  await prisma.organisation.delete({ where: { id: orgB.id } });

  // ============================================================
  // TEST 11 - historique : une étude OFFICIEL v1 reste byte-identique après
  // la création d'une v2 (jamais écrasée, section 21/28).
  // ============================================================
  console.log("\n=== TEST 11 - immutabilité de l'historique des études ===");
  const etudeV1AvantV2 = await prisma.etudeDossier.findUniqueOrThrow({ where: { id: etude.id } });
  const contextV2 = await buildStudyContext(dossier.id, org.id);
  const etudeV2 = await prisma.etudeDossier.create({
    data: {
      organisationId: org.id,
      dossierId: dossier.id,
      version: 2,
      mode: "OFFICIEL",
      inputsSnapshot: JSON.parse(JSON.stringify(contextV2)),
      resultsSnapshot: JSON.parse(JSON.stringify({ scenarios: [], recommendedScenarioLabel: "Scénario actuellement le plus favorable selon les données disponibles." })),
      inputHash: computeStudyInputHash(contextV2),
      recommendedScenarioId: null,
      createdById: admin.id,
    },
  });
  const etudeV1ApresV2 = await prisma.etudeDossier.findUniqueOrThrow({ where: { id: etude.id } });
  assert(etudeV1ApresV2.version === 1, "l'étude v1 garde son numéro de version après création de v2");
  assert(JSON.stringify(etudeV1ApresV2.inputsSnapshot) === JSON.stringify(etudeV1AvantV2.inputsSnapshot), "inputsSnapshot de v1 inchangé après création de v2");
  assert(JSON.stringify(etudeV1ApresV2.resultsSnapshot) === JSON.stringify(etudeV1AvantV2.resultsSnapshot), "resultsSnapshot de v1 inchangé après création de v2");
  assert(etudeV1ApresV2.inputHash === etudeV1AvantV2.inputHash, "inputHash de v1 inchangé après création de v2");
  const nbEtudesDossier = await prisma.etudeDossier.count({ where: { dossierId: dossier.id } });
  assert(nbEtudesDossier === 2, `2 versions distinctes existent pour ce dossier (trouvé ${nbEtudesDossier})`);
  assert(etudeV2.version === 2, "v2 a bien le numéro de version 2");

  // --- Nettoyage ---
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: org.id } });
  await prisma.etudeDossier.deleteMany({ where: { organisationId: org.id } });
  await prisma.calculReglementaire.deleteMany({ where: { organisationId: org.id } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossierId: dossier.id } });
  await prisma.tarifDelegataireCee.deleteMany({ where: { organisationId: org.id } });
  await prisma.delegataireCee.deleteMany({ where: { id: { in: [delegataire1.id, delegataire2.id] } } });
  await prisma.dossier.delete({ where: { id: dossier.id } });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, commercial.id, autreCommercial.id] } } });
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
