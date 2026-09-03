import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  getEntreeLignesForDossier,
  calculateEntrees,
  getFinancialSummaryForDossier,
  calculateBlockedAmountForDossier,
  resolveEntreeSourceForFlux,
} from "../src/lib/financial-engine";
import { getNextBestActions } from "../src/lib/next-best-action";

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
  const org = await prisma.organisation.create({ data: { nom: "Test Finance P6C", slug: `test-fin-p6c-${Date.now()}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const client = await prisma.client.create({ data: { prenom: "Test", nom: "P6C", organisationId: org.id } });

  async function nouveauDossier(devisCts: number, mprCts = 0, ceeCts = 0, encaisseClientCts = 0, encaisseMprCts = 0, encaisseCeeCts = 0) {
    return prisma.dossier.create({
      data: {
        reference: `TEST-P6C-${Math.random().toString(36).slice(2, 8)}`,
        clientId: client.id,
        organisationId: org.id,
        typeId: type.id,
        statutId: statut.id,
        montantDevisTTC: devisCts,
        montantAideMPR: mprCts,
        montantAideCEE: ceeCts,
        montantEncaisseClient: encaisseClientCts,
        montantEncaisseMPR: encaisseMprCts,
        montantEncaisseCEE: encaisseCeeCts,
      },
    });
  }

  // ============================================================
  // TEST 0 : resolveEntreeSourceForFlux en isolation (section 5)
  // ============================================================
  console.log("\nTEST 0 - resolveEntreeSourceForFlux (fonction centrale)");
  assert(resolveEntreeSourceForFlux({ nombreMouvementsDetailles: 0 }) === "LEGACY_AGGREGATE", "0 mouvement -> LEGACY_AGGREGATE");
  assert(resolveEntreeSourceForFlux({ nombreMouvementsDetailles: 1 }) === "MOUVEMENT", "1 mouvement -> MOUVEMENT");
  assert(resolveEntreeSourceForFlux({ nombreMouvementsDetailles: 2 }) === "MOUVEMENT", "2 mouvements -> MOUVEMENT (jamais additionné au legacy)");

  // ============================================================
  // TEST 1 : CEE legacy 5 000 € + mouvement détaillé CEE 5 000 € -> 5 000 €
  // (isolé : devisTTC = aideCEE pour que la part client legacy soit nulle et
  // ne pollue pas la lecture du flux CEE seul)
  // ============================================================
  console.log("\nTEST 1 - CEE legacy 5 000 € + mouvement détaillé 5 000 € (isolé)");
  const dCee = await nouveauDossier(500_000, 0, 500_000, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dCee.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", montantPrevuCts: 500_000, statut: "A_RECEVOIR" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dCee.id);
    const lignesCEE = lignes.filter((l) => l.flux === "CEE");
    const totalCEE = lignesCEE.reduce((s, l) => s + l.resteCts, 0);
    assert(lignesCEE.length === 1, `getEntreeLignesForDossier: 1 seule ligne CEE (trouvé ${lignesCEE.length})`);
    assert(lignesCEE[0]?.source === "MOUVEMENT", "getEntreeLignesForDossier: la ligne CEE est bien le mouvement, pas le legacy");
    assert(totalCEE === 500_000, `getEntreeLignesForDossier: CEE retenu = 5 000 € et NON 10 000 € (trouvé ${totalCEE / 100} €)`);

    const entrees = await calculateEntrees(dCee.id);
    assert(entrees.resteAEncaisserCts === 500_000, `calculateEntrees: total = 5 000 € (trouvé ${entrees.resteAEncaisserCts / 100} €)`);

    const resume = await getFinancialSummaryForDossier(dCee.id);
    assert(resume.resteAEncaisserCts === 500_000, `getFinancialSummaryForDossier: resteAEncaisserCts = 5 000 € (trouvé ${resume.resteAEncaisserCts / 100} €)`);

    const bloque = await calculateBlockedAmountForDossier(dCee.id);
    assert(bloque.montantBloqueCts === 500_000, `calculateBlockedAmountForDossier: 5 000 € (trouvé ${bloque.montantBloqueCts / 100} €)`);
    assert(bloque.details.filter((detail) => detail.origine.includes("CEE")).length === 1, "calculateBlockedAmountForDossier: une seule ligne CEE dans le détail (pas legacy + mouvement)");

    const actions = await getNextBestActions({ organisationId: org.id, scope: "all" });
    const actionsDossier = actions.filter((a) => a.dossierId === dCee.id);
    // Aucune action MOUVEMENT_FINANCIER attendue ici (le mouvement n'est pas
    // en retard - cf. section 24 du prompt P6, seuls les mouvements
    // exigibles/en retard remontent) ; on vérifie surtout qu'aucune action
    // ne porte un montantBloqueCts doublé.
    assert(actionsDossier.every((a) => a.montantBloqueCts <= 500_000), "Next Best Action: montantBloqueCts annoté ne dépasse jamais 5 000 € pour ce dossier");
  }

  // ============================================================
  // TEST 2a : CLIENT legacy + mouvement CLIENT (isolé)
  // ============================================================
  console.log("\nTEST 2a - CLIENT legacy 5 000 € + mouvement détaillé 5 000 €");
  const dClient = await nouveauDossier(500_000, 0, 0, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dClient.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", montantPrevuCts: 500_000, statut: "PREVU" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dClient.id);
    const lignesClient = lignes.filter((l) => l.flux === "CLIENT");
    const total = lignesClient.reduce((s, l) => s + l.resteCts, 0);
    assert(lignesClient.length === 1 && total === 500_000, `CLIENT retenu = 5 000 € et NON 10 000 € (trouvé ${lignesClient.length} ligne(s), ${total / 100} €)`);
  }

  // ============================================================
  // TEST 2b : MPR/ANAH legacy + mouvement ANAH/MPR (isolé)
  // ============================================================
  console.log("\nTEST 2b - MPR/ANAH legacy 5 000 € + mouvement détaillé 5 000 €");
  const dMpr = await nouveauDossier(500_000, 500_000, 0, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dMpr.id, type: "ENTREE", categorie: "ENCAISSEMENT_MPR", montantPrevuCts: 500_000, statut: "A_RECEVOIR" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dMpr.id);
    const lignesMpr = lignes.filter((l) => l.flux === "MPR");
    const total = lignesMpr.reduce((s, l) => s + l.resteCts, 0);
    assert(lignesMpr.length === 1 && total === 500_000, `MPR/ANAH retenu = 5 000 € et NON 10 000 € (trouvé ${lignesMpr.length} ligne(s), ${total / 100} €)`);
  }

  // ============================================================
  // TEST 3 : cas partiel - CEE legacy 5 000 €, mouvement prévu 5 000 €, reçu 2 000 €
  // ============================================================
  console.log("\nTEST 3 - cas partiel (prévu 5 000 €, reçu 2 000 €, reste 3 000 €)");
  const dPartiel = await nouveauDossier(500_000, 0, 500_000, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dPartiel.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", montantPrevuCts: 500_000, montantReelCts: 200_000, statut: "PARTIEL" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dPartiel.id);
    const lignesCEE = lignes.filter((l) => l.flux === "CEE");
    assert(lignesCEE.length === 1, `1 seule ligne CEE (trouvé ${lignesCEE.length})`);
    const l = lignesCEE[0]!;
    assert(l.montantPrevuCts === 500_000, `flux total (prévu) = 5 000 € (trouvé ${l.montantPrevuCts / 100} €)`);
    assert(l.montantReelCts === 200_000, `reçu = 2 000 € (trouvé ${l.montantReelCts / 100} €)`);
    assert(l.resteCts === 300_000, `reste = 3 000 € et NON 8 000 € (trouvé ${l.resteCts / 100} €)`);

    const entrees = await calculateEntrees(dPartiel.id);
    assert(entrees.encaisseCts === 200_000, `calculateEntrees: encaissé = 2 000 € (trouvé ${entrees.encaisseCts / 100} €)`);
    assert(entrees.resteAEncaisserCts === 300_000, `calculateEntrees: reste = 3 000 € (trouvé ${entrees.resteAEncaisserCts / 100} €)`);
  }

  // ============================================================
  // TEST 4 : plusieurs mouvements détaillés - legacy totalement ignoré
  // ============================================================
  console.log("\nTEST 4 - plusieurs mouvements CEE (2 000 € + 3 000 €), legacy 5 000 € ignoré");
  const dMulti = await nouveauDossier(500_000, 0, 500_000, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dMulti.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", montantPrevuCts: 200_000, statut: "A_RECEVOIR" },
  });
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dMulti.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", montantPrevuCts: 300_000, statut: "A_RECEVOIR" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dMulti.id);
    const lignesCEE = lignes.filter((l) => l.flux === "CEE");
    assert(lignesCEE.length === 2, `2 lignes CEE, toutes MOUVEMENT (aucune ligne legacy) - trouvé ${lignesCEE.length}`);
    assert(lignesCEE.every((l) => l.source === "MOUVEMENT"), "aucune des lignes CEE n'est un repli legacy");
    const total = lignesCEE.reduce((s, l) => s + l.resteCts, 0);
    assert(total === 500_000, `total CEE = 5 000 € (2 000 + 3 000, legacy totalement ignoré) - trouvé ${total / 100} €`);
  }

  // --- Nettoyage ---
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: org.id } });
  await prisma.dossier.deleteMany({ where: { organisationId: org.id } });
  await prisma.client.deleteMany({ where: { organisationId: org.id } });
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
