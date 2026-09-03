import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  calculateContractualRevenue,
  getRemainingAmount,
  calculateForecastMargin,
  calculateMargeSurCoutsReelsConnus,
  getCreancesForDossier,
  getCreancesForOrganisation,
  getCashflowForecast,
  getMargesDossiers,
  getMouvementsNonSoldes,
  computeMouvementAuditDiff,
} from "../src/lib/financial-engine";
import { getNextBestActions } from "../src/lib/next-best-action";
import { hasPermission, type UserContext } from "../src/lib/authz";
import { logAudit } from "../src/lib/audit";

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

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

async function main() {
  const orgA = await prisma.organisation.create({ data: { nom: "Test Finance A", slug: `test-fin-a-${Date.now()}` } });
  const orgB = await prisma.organisation.create({ data: { nom: "Test Finance B", slug: `test-fin-b-${Date.now()}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const clientA = await prisma.client.create({ data: { prenom: "Test", nom: "Finance-A", organisationId: orgA.id } });
  const clientB = await prisma.client.create({ data: { prenom: "Test", nom: "Finance-B", organisationId: orgB.id } });
  const userAdmin = await prisma.user.create({
    data: { name: "Admin Test", email: `admin-fin-${Date.now()}@test.local`, password: "x", role: "ADMIN", organisationId: orgA.id },
  });

  async function nouveauDossier(orgId: string, clientId: string, devisCts: number, mprCts = 0, ceeCts = 0) {
    return prisma.dossier.create({
      data: {
        reference: `TEST-FIN-${Math.random().toString(36).slice(2, 8)}`,
        clientId,
        organisationId: orgId,
        typeId: type.id,
        statutId: statut.id,
        montantDevisTTC: devisCts,
        montantAideMPR: mprCts,
        montantAideCEE: ceeCts,
      },
    });
  }

  // ============================================================
  // TEST 1 : CA contractuel = devis TTC, jamais devis + aides
  // ============================================================
  console.log("\nTEST 1 - CA contractuel (25 000 €, pas 50 000 €)");
  const dossier1 = await nouveauDossier(orgA.id, clientA.id, 2_500_000, 1_800_000, 0);
  {
    const ca = await calculateContractualRevenue(dossier1.id);
    assert(ca.amountCts === 2_500_000, `CA = 25 000 € (trouvé ${ca.amountCts / 100} €)`);
    assert(ca.amountCts !== 5_000_000, "CA n'est jamais devis + aide (pas 50 000 €)");
    assert(ca.confidence === "HIGH", "confidence HIGH quand le devis est renseigné");
  }

  // ============================================================
  // TEST 2 : montant partiel - reste = prévu - reçu
  // ============================================================
  console.log("\nTEST 2 - montant partiel (10 000 € prévu, 4 000 € reçu)");
  {
    const reste = getRemainingAmount({ statut: "PARTIEL", montantPrevuCts: 1_000_000, montantReelCts: 400_000 });
    assert(reste === 600_000, `reste = 6 000 € (trouvé ${reste / 100} €)`);
  }

  // ============================================================
  // TEST 3 : marge prévisionnelle = CA - coûts prévus
  // ============================================================
  console.log("\nTEST 3 - marge prévisionnelle (coûts prévus 15 000 €, CA 25 000 €)");
  await prisma.dossierPosteTravaux.create({
    data: { dossierId: dossier1.id, type: "PAC_AIR_EAU", montantMaterielTTCCts: 1_500_000 },
  });
  {
    const marge = await calculateForecastMargin(dossier1.id);
    assert(marge.coutsCts === 1_500_000, `coûts prévus = 15 000 € (trouvé ${marge.coutsCts / 100} €)`);
    assert(marge.margeCts === 1_000_000, `marge prévisionnelle = 10 000 € (trouvé ${marge.margeCts / 100} €)`);
    assert(marge.margePct === 40, `marge prévisionnelle = 40 % (trouvé ${marge.margePct} %)`);
  }

  // ============================================================
  // TEST 4 : marge réelle = CA - coûts réels
  // ============================================================
  console.log("\nTEST 4 - marge réelle (coûts réels 17 500 €, revenu 25 000 €)");
  await prisma.mouvementFinancier.create({
    data: {
      organisationId: orgA.id,
      dossierId: dossier1.id,
      type: "SORTIE",
      categorie: "AUTRE_SORTIE",
      montantReelCts: 1_750_000,
      statut: "PAYE",
    },
  });
  {
    const marge = await calculateMargeSurCoutsReelsConnus(dossier1.id);
    assert(marge.coutsCts === 1_750_000, `coûts réels = 17 500 € (trouvé ${marge.coutsCts / 100} €)`);
    assert(marge.margeCts === 750_000, `marge réelle = 7 500 € (trouvé ${marge.margeCts / 100} €)`);
    assert(marge.margePct === 30, `marge réelle = 30 % (trouvé ${marge.margePct} %)`);
  }

  // ============================================================
  // TEST 5 : créance client (12 000 € - 5 000 € recouvré = 7 000 € reste)
  // ============================================================
  console.log("\nTEST 5 - créance client (12 000 € dont 5 000 € recouvré)");
  const dossier5 = await nouveauDossier(orgA.id, clientA.id, 1_200_000);
  await prisma.mouvementFinancier.create({
    data: {
      organisationId: orgA.id,
      dossierId: dossier5.id,
      type: "ENTREE",
      categorie: "CLIENT_SOLDE",
      payeurType: "CLIENT",
      montantPrevuCts: 1_200_000,
      montantReelCts: 500_000,
      statut: "PARTIEL",
    },
  });
  {
    const creances = await getCreancesForDossier(dossier5.id);
    assert(creances.length === 1, `1 créance trouvée (trouvé ${creances.length})`);
    assert(creances[0].montantInitialCts === 1_200_000, "montant initial = 12 000 €");
    assert(creances[0].montantRecouvreCts === 500_000, "montant recouvré = 5 000 €");
    assert(creances[0].resteCts === 700_000, `reste = 7 000 € (trouvé ${creances[0].resteCts / 100} €)`);
    assert(creances[0].statut === "PARTIELLE", `statut PARTIELLE (trouvé ${creances[0].statut})`);
  }

  // ============================================================
  // TEST 6 : avance ANAH versée au client - créance correcte, pas de double CA
  // ============================================================
  console.log("\nTEST 6 - avance ANAH versée au client (créance générique, CA inchangé)");
  const caAvant = await calculateContractualRevenue(dossier1.id);
  await prisma.mouvementFinancier.create({
    data: {
      organisationId: orgA.id,
      dossierId: dossier1.id,
      type: "ENTREE",
      categorie: "REMBOURSEMENT_AVANCE_CLIENT",
      payeurType: "CLIENT",
      montantPrevuCts: 500_000,
      statut: "A_RECEVOIR",
      origine: "AVANCE_ANAH_VERSEE_AU_CLIENT",
      commentaire: "ANAH a versé l'aide directement au client, l'entreprise avait avancé ce montant.",
    },
  });
  {
    const caApres = await calculateContractualRevenue(dossier1.id);
    assert(caApres.amountCts === caAvant.amountCts, "le CA contractuel ne change pas après l'avance (pas de double comptage)");
    const creances = await getCreancesForDossier(dossier1.id);
    const creanceAvance = creances.find((c) => c.origine === "AVANCE_ANAH_VERSEE_AU_CLIENT");
    assert(!!creanceAvance, "la créance liée à l'avance ANAH est bien remontée");
    assert(creanceAvance?.resteCts === 500_000, `créance d'avance = 5 000 € (trouvé ${(creanceAvance?.resteCts ?? 0) / 100} €)`);
  }

  // ============================================================
  // TEST 7 : mouvement sans date - jamais rattaché à une semaine de trésorerie
  // ============================================================
  console.log("\nTEST 7 - mouvement sans date exclu de la trésorerie datée");
  const dossier7 = await nouveauDossier(orgA.id, clientA.id, 300_000);
  await prisma.mouvementFinancier.create({
    data: { organisationId: orgA.id, dossierId: dossier7.id, type: "ENTREE", categorie: "AUTRE_ENTREE", montantPrevuCts: 100_000, statut: "PREVU", datePrevue: null },
  });
  {
    const cashflow = await getCashflowForecast(orgA.id, daysAgo(1), daysFromNow(60), "semaine");
    const totalDansBuckets = cashflow.buckets.reduce((s, b) => s + b.entreesCts, 0);
    assert(cashflow.sansDate.entreesCts >= 100_000, "le mouvement sans date apparaît dans sansDate");
    assert(cashflow.sansDate.nombreMouvements >= 1, "le compteur sansDate est incrémenté");
    assert(totalDansBuckets === 0, "aucun bucket daté ne contient ce mouvement sans date (60 000 cts nulle part ailleurs)");
  }

  // ============================================================
  // TEST 8 : cloisonnement inter-organisations
  // ============================================================
  console.log("\nTEST 8 - cloisonnement inter-organisations");
  const dossierB = await nouveauDossier(orgB.id, clientB.id, 900_000);
  await prisma.mouvementFinancier.create({
    data: { organisationId: orgB.id, dossierId: dossierB.id, type: "ENTREE", categorie: "CLIENT_SOLDE", payeurType: "CLIENT", montantPrevuCts: 900_000, statut: "A_RECEVOIR" },
  });
  {
    const entreesA = await getMouvementsNonSoldes(orgA.id, "ENTREE");
    const entreesB = await getMouvementsNonSoldes(orgB.id, "ENTREE");
    assert(entreesA.every((m) => m.dossierId !== dossierB.id), "aucun mouvement de l'org B ne fuit vers l'org A");
    assert(entreesB.some((m) => m.dossierId === dossierB.id), "le mouvement de l'org B est bien visible depuis l'org B");
    const creancesA = await getCreancesForOrganisation(orgA.id);
    assert(creancesA.every((c) => c.dossierId !== dossierB.id), "aucune créance de l'org B ne fuit vers l'org A");
    const margesA = await getMargesDossiers(orgA.id);
    assert(margesA.every((m) => m.dossierId !== dossierB.id), "aucune marge de dossier de l'org B ne fuit vers l'org A");
  }

  // ============================================================
  // TEST 9 / TEST 10 : permissions COMMERCIAL vs COMPTABILITE
  // ============================================================
  console.log("\nTEST 9 - Commercial : marge interne inaccessible");
  {
    const ctxCommercial: UserContext = { userId: "x", organisationId: orgA.id, role: "COMMERCIAL" };
    assert(!hasPermission(ctxCommercial, "VIEW_MARGIN"), "COMMERCIAL n'a pas VIEW_MARGIN");
    assert(!hasPermission(ctxCommercial, "VIEW_INTERNAL_COSTS"), "COMMERCIAL n'a pas VIEW_INTERNAL_COSTS");
  }
  console.log("\nTEST 10 - Comptabilité : accès finance autorisé");
  {
    const ctxCompta: UserContext = { userId: "x", organisationId: orgA.id, role: "COMPTABILITE" };
    assert(hasPermission(ctxCompta, "VIEW_FINANCIAL_SUMMARY"), "COMPTABILITE a VIEW_FINANCIAL_SUMMARY");
    assert(hasPermission(ctxCompta, "VIEW_MARGIN"), "COMPTABILITE a VIEW_MARGIN");
    assert(hasPermission(ctxCompta, "VIEW_INTERNAL_COSTS"), "COMPTABILITE a VIEW_INTERNAL_COSTS");
    assert(hasPermission(ctxCompta, "MANAGE_FINANCE"), "COMPTABILITE a MANAGE_FINANCE");
  }

  // ============================================================
  // TEST 11 : Next Best Action financier - créance en retard remonte
  // ============================================================
  console.log("\nTEST 11 - créance en retard remonte dans Next Best Action");
  const dossier11 = await nouveauDossier(orgA.id, clientA.id, 400_000);
  const mvtRetard = await prisma.mouvementFinancier.create({
    data: {
      organisationId: orgA.id,
      dossierId: dossier11.id,
      type: "ENTREE",
      categorie: "CLIENT_SOLDE",
      payeurType: "CLIENT",
      montantPrevuCts: 400_000,
      statut: "A_RECEVOIR",
      datePrevue: daysAgo(10),
    },
  });
  {
    const actions = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    const action = actions.find((a) => a.id === `mouvement:${mvtRetard.id}`);
    assert(!!action, "l'action liée à la créance en retard est bien générée");
    assert((action?.joursRetard ?? 0) === 10, `10 jours de retard (trouvé ${action?.joursRetard})`);
    assert(!!action?.titre.includes("en retard"), `titre mentionne le retard (trouvé "${action?.titre}")`);
  }

  // ============================================================
  // TEST 12 : audit avant/après sur modification de montant
  // ============================================================
  console.log("\nTEST 12 - audit avant/après sur modification de montant");
  {
    const diff = computeMouvementAuditDiff(
      { montantPrevuCts: 100_000, montantReelCts: null, datePrevue: daysAgo(1), dateReelle: null },
      { montantPrevuCts: 120_000, montantReelCts: null, datePrevue: daysAgo(1), dateReelle: null }
    );
    assert(diff.montantPrevuAvantCts === 100_000, "montantPrevuAvantCts = 100 000 cts");
    assert(diff.montantPrevuApresCts === 120_000, "montantPrevuApresCts = 120 000 cts");
    assert(diff.datePrevueAvant === undefined, "aucune entrée de date quand la date n'a pas changé");

    await logAudit({
      organisationId: orgA.id,
      userId: userAdmin.id,
      entityType: "MouvementFinancier",
      entityId: mvtRetard.id,
      action: "MODIFIER",
      metadata: { dossierId: dossier11.id, ...diff },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { organisationId: orgA.id, entityType: "MouvementFinancier", entityId: mvtRetard.id, action: "MODIFIER" },
      orderBy: { createdAt: "desc" },
    });
    assert(audit !== null, "AuditLog MODIFIER créé");
    const metadata = audit?.metadata as Record<string, unknown> | null;
    assert(metadata?.montantPrevuAvantCts === 100_000, "AuditLog.metadata.montantPrevuAvantCts = 100 000");
    assert(metadata?.montantPrevuApresCts === 120_000, "AuditLog.metadata.montantPrevuApresCts = 120 000");
  }

  // --- Nettoyage ---
  await prisma.auditLog.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.dossierPosteTravaux.deleteMany({ where: { dossier: { organisationId: { in: [orgA.id, orgB.id] } } } });
  await prisma.dossier.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { organisationId: orgA.id } });
  await prisma.client.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organisation.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
