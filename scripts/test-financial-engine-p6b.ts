import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  calculateMargeSurCoutsReelsConnus,
  calculateMargeRealisee,
  calculateEntrees,
  getEntreeLignesForDossier,
  getEntreeLignesForOrganisation,
  getCashflowForecast,
  getFinancialSummaryForDossier,
  getMargesDossiers,
} from "../src/lib/financial-engine";

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
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function main() {
  const org = await prisma.organisation.create({ data: { nom: "Test Finance P6B", slug: `test-fin-p6b-${Date.now()}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const client = await prisma.client.create({ data: { prenom: "Test", nom: "P6B", organisationId: org.id } });

  async function nouveauDossier(devisCts: number, mprCts = 0, ceeCts = 0, encaisseClientCts = 0, encaisseMprCts = 0, encaisseCeeCts = 0) {
    return prisma.dossier.create({
      data: {
        reference: `TEST-P6B-${Math.random().toString(36).slice(2, 8)}`,
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
  // TEST 1 : marge sur coûts réels vs marge réalisée (non calculable)
  // ============================================================
  console.log("\nTEST 1 - marge sur coûts réels connus vs marge réalisée");
  const dossier1 = await nouveauDossier(2_500_000);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dossier1.id, type: "SORTIE", categorie: "AUTRE_SORTIE", montantReelCts: 1_750_000, statut: "PAYE" },
  });
  {
    const marge = await calculateMargeSurCoutsReelsConnus(dossier1.id);
    assert(marge.margeCts === 750_000, `margeSurCoutsReels = 7 500 € (trouvé ${marge.margeCts / 100} €)`);
    assert(marge.margePct === 30, `margeSurCoutsReels = 30 % (trouvé ${marge.margePct} %)`);

    const realisee = await calculateMargeRealisee(dossier1.id);
    assert(realisee.statut === "NON_CALCULABLE", `margeRealisee = NON_CALCULABLE (trouvé ${realisee.statut})`);
    assert(
      "raison" in realisee && realisee.raison.length > 0,
      "margeRealisee porte une raison explicite (pas de revenu reconnu fiable)"
    );

    const resume = await getFinancialSummaryForDossier(dossier1.id);
    assert(resume.margeSurCoutsReelsCts === 750_000, "getFinancialSummaryForDossier expose margeSurCoutsReelsCts (pas margeReelleCts)");
    assert(resume.margeRealisee.statut === "NON_CALCULABLE", "getFinancialSummaryForDossier expose margeRealisee = NON_CALCULABLE");
  }

  // ============================================================
  // TEST 2 : dossier 100% legacy - compté dans le total à encaisser
  // ============================================================
  console.log("\nTEST 2 - dossier legacy sans MouvementFinancier compté dans /finances");
  // ANAH restant 10 000 € (aide 10 000, encaissé 0), client restant 2 000 €
  // (devis - aide = 2 000, encaissé 0) => devis = 12 000 €.
  const dossier2 = await nouveauDossier(1_200_000, 1_000_000, 0, 0, 0, 0);
  {
    const lignes = await getEntreeLignesForDossier(dossier2.id);
    assert(lignes.every((l) => l.source === "LEGACY_AGGREGATE"), "toutes les lignes sont des repli legacy (aucun mouvement détaillé)");
    const total = lignes.reduce((s, l) => s + l.resteCts, 0);
    assert(total === 1_200_000, `total à encaisser (legacy) = 12 000 € (trouvé ${total / 100} €)`);

    const entrees = await calculateEntrees(dossier2.id);
    assert(entrees.resteAEncaisserCts === 1_200_000, `calculateEntrees agrège aussi 12 000 € (trouvé ${entrees.resteAEncaisserCts / 100} €)`);

    const orgLignes = await getEntreeLignesForOrganisation(org.id);
    assert(
      orgLignes.some((l) => l.dossierId === dossier2.id && l.source === "LEGACY_AGGREGATE"),
      "le dossier 100% legacy apparaît bien dans la vue organisation (ne disparaît pas de /finances)"
    );

    // Aucune fausse date de cashflow : ce dossier n'a aucun MouvementFinancier
    // daté, donc aucun bucket ne doit porter son montant.
    const cashflow = await getCashflowForecast(org.id, daysAgo(30), daysFromNow(90), "semaine");
    const totalBuckets = cashflow.buckets.reduce((s, b) => s + b.entreesCts, 0);
    assert(totalBuckets !== 1_200_000, "le montant legacy n'apparaît dans aucun bucket de trésorerie daté");
    assert(cashflow.sansDate.entreesCts !== 1_200_000 || cashflow.sansDate.nombreMouvements === 0, "le montant legacy n'est pas non plus injecté dans sansDate (mécanisme réservé aux vrais mouvements)");
  }

  // ============================================================
  // TEST 3 : mouvement détaillé CEE présent -> pas de double comptage avec le legacy CEE
  // ============================================================
  // Dossier isolé (le montant CEE legacy est fixé DÈS LA CRÉATION, cohérent
  // avec devisTTC, pour ne pas perturber la part client legacy - celle-ci
  // dépend elle aussi de montantAideCEE via resteAChargeCents).
  console.log("\nTEST 3 - mouvement CEE détaillé : pas de double comptage avec le legacy");
  const dossier3 = await nouveauDossier(1_000_000, 0, 500_000, 0, 0, 0);
  await prisma.mouvementFinancier.create({
    data: { organisationId: org.id, dossierId: dossier3.id, type: "ENTREE", categorie: "ENCAISSEMENT_CEE", montantPrevuCts: 500_000, statut: "A_RECEVOIR" },
  });
  {
    const lignes = await getEntreeLignesForDossier(dossier3.id);
    const lignesCEE = lignes.filter((l) => l.flux === "CEE");
    assert(lignesCEE.length === 1, `une seule ligne CEE (le mouvement détaillé, pas le legacy en plus) - trouvé ${lignesCEE.length}`);
    assert(lignesCEE[0]?.source === "MOUVEMENT", "la ligne CEE restante est bien le mouvement détaillé");
    assert(lignesCEE[0]?.resteCts === 500_000, `montant CEE = 5 000 € (le mouvement, pas 5 000 € legacy + 5 000 €) - trouvé ${(lignesCEE[0]?.resteCts ?? 0) / 100} €`);

    const entrees = await calculateEntrees(dossier3.id);
    // 500 000 (client legacy : devis 1 000 000 - CEE 500 000) + 500 000 (CEE détaillé) = 1 000 000, PAS 1 500 000.
    assert(entrees.resteAEncaisserCts === 1_000_000, `total = 10 000 € et non 15 000 € (pas de double comptage CEE) - trouvé ${entrees.resteAEncaisserCts / 100} €`);
  }

  // ============================================================
  // TEST 4 : financialDataQuality (DETAILED / PARTIAL / LEGACY / INSUFFICIENT)
  // ============================================================
  console.log("\nTEST 4 - financialDataQuality");
  {
    // DETAILED : CA connu, seul flux actif (CLIENT) entièrement détaillé.
    const dDetailed = await nouveauDossier(500_000);
    await prisma.mouvementFinancier.create({
      data: { organisationId: org.id, dossierId: dDetailed.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", montantPrevuCts: 500_000, statut: "PREVU" },
    });
    const qDetailed = await getFinancialSummaryForDossier(dDetailed.id);
    assert(qDetailed.financialDataQuality === "DETAILED", `DETAILED attendu (trouvé ${qDetailed.financialDataQuality})`);

    // LEGACY : CA connu, uniquement des replis legacy, aucun mouvement.
    const dLegacy = await nouveauDossier(500_000, 100_000, 0, 0, 0, 0);
    const qLegacy = await getFinancialSummaryForDossier(dLegacy.id);
    assert(qLegacy.financialDataQuality === "LEGACY", `LEGACY attendu (trouvé ${qLegacy.financialDataQuality})`);

    // PARTIAL : un flux détaillé (CLIENT) + un flux en repli legacy (MPR).
    const dPartial = await nouveauDossier(500_000, 100_000, 0, 0, 0, 0);
    await prisma.mouvementFinancier.create({
      data: { organisationId: org.id, dossierId: dPartial.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", montantPrevuCts: 400_000, statut: "PREVU" },
    });
    const qPartial = await getFinancialSummaryForDossier(dPartial.id);
    assert(qPartial.financialDataQuality === "PARTIAL", `PARTIAL attendu (trouvé ${qPartial.financialDataQuality})`);

    // INSUFFICIENT : CA inconnu (pas de devis).
    const dInsuffisant = await nouveauDossier(0);
    const qInsuffisant = await getFinancialSummaryForDossier(dInsuffisant.id);
    assert(qInsuffisant.financialDataQuality === "INSUFFICIENT", `INSUFFICIENT attendu (trouvé ${qInsuffisant.financialDataQuality})`);
  }

  // ============================================================
  // TEST 5 : dashboard et /finances utilisent la même couche centrale
  // ============================================================
  console.log("\nTEST 5 - cohérence dashboard / /finances (même couche centrale)");
  {
    const margesDossiers = await getMargesDossiers(org.id);
    const totalDepuisMarges = margesDossiers.reduce((s, d) => s + d.resteAEncaisserCts, 0);

    const lignesOrg = await getEntreeLignesForOrganisation(org.id);
    const totalDepuisLignes = lignesOrg.reduce((s, l) => s + l.resteCts, 0);

    assert(
      totalDepuisMarges === totalDepuisLignes,
      `le total "reste à encaisser" est identique entre getMargesDossiers (dashboard/finances F) et getEntreeLignesForOrganisation (finances A) - ${totalDepuisMarges} vs ${totalDepuisLignes}`
    );
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
