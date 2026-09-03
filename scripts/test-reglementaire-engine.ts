import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  calculateCeeCumac,
  getApplicableRuleVersion,
  getDossierEngagementDate,
  validateOverrideReason,
  assertRuleVersionEditable,
} from "../src/lib/reglementaire/engine";
import { calculateCeeValuation, compareCeeDelegates } from "../src/lib/reglementaire/valuation";
import { hasPermission, type UserContext } from "../src/lib/authz";
import type { ZoneClimatique } from "../src/generated/prisma/enums";

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

// ============================================================
// Reproduction EXACTE de l'ancien calculateur (CeeCumacCalculator.tsx) pour
// la comparaison de parité (section 8 du prompt P7) - même table, même
// logique de tranche, copiées telles quelles.
// ============================================================
type SurfaceTranche = "moins70" | "70a90" | "plus90";
type Etas = "111a140" | "plus140";

const CUMAC: Record<ZoneClimatique, Record<SurfaceTranche, Record<Etas, number>>> = {
  H1: {
    moins70: { "111a140": 272_700, plus140: 327_600 },
    "70a90": { "111a140": 381_780, plus140: 458_640 },
    plus90: { "111a140": 545_400, plus140: 655_200 },
  },
  H2: {
    moins70: { "111a140": 227_250, plus140: 273_000 },
    "70a90": { "111a140": 318_150, plus140: 382_200 },
    plus90: { "111a140": 454_500, plus140: 546_000 },
  },
  H3: {
    moins70: { "111a140": 159_075, plus140: 191_100 },
    "70a90": { "111a140": 222_705, plus140: 267_540 },
    plus90: { "111a140": 318_150, plus140: 382_200 },
  },
};

function ancienSurfaceTranche(surfaceM2: number): SurfaceTranche {
  if (surfaceM2 < 70) return "moins70";
  if (surfaceM2 < 90) return "70a90";
  return "plus90";
}

function ancienCalculateur(zone: ZoneClimatique, surfaceM2: number, etas: Etas): number {
  return CUMAC[zone][ancienSurfaceTranche(surfaceM2)][etas];
}

const DATE_ENGAGEMENT_DEMO = new Date("2026-06-15");

async function main() {
  // ============================================================
  // SECTION 8 : parité ancien calculateur vs nouveau moteur (>= 10 cas)
  // ============================================================
  console.log("\n=== PARITÉ ANCIEN / NOUVEAU MOTEUR (BAR-TH-171) ===");
  const cas: { zone: ZoneClimatique; surface: number; etas: Etas; label: string }[] = [
    { zone: "H1", surface: 50, etas: "111a140", label: "H1, 50 m² (moins70), 111-140%" },
    { zone: "H1", surface: 50, etas: "plus140", label: "H1, 50 m² (moins70), ≥140%" },
    { zone: "H1", surface: 80, etas: "111a140", label: "H1, 80 m² (70-90), 111-140%" },
    { zone: "H1", surface: 80, etas: "plus140", label: "H1, 80 m² (70-90), ≥140%" },
    { zone: "H1", surface: 120, etas: "111a140", label: "H1, 120 m² (plus90), 111-140%" },
    { zone: "H2", surface: 65, etas: "plus140", label: "H2, 65 m² (moins70), ≥140%" },
    { zone: "H2", surface: 90, etas: "111a140", label: "H2, 90 m² pile (frontière plus90), 111-140%" },
    { zone: "H2", surface: 89.99, etas: "plus140", label: "H2, 89.99 m² (frontière 70-90), ≥140%" },
    { zone: "H3", surface: 70, etas: "111a140", label: "H3, 70 m² pile (frontière 70-90), 111-140%" },
    { zone: "H3", surface: 69.99, etas: "plus140", label: "H3, 69.99 m² (frontière moins70), ≥140%" },
    { zone: "H3", surface: 150, etas: "plus140", label: "H3, 150 m² (plus90), ≥140%" },
    { zone: "H1", surface: 30.5, etas: "111a140", label: "H1, 30.5 m² (décimal, moins70), 111-140%" },
  ];

  let paritesOk = 0;
  for (const c of cas) {
    const ancien = ancienCalculateur(c.zone, c.surface, c.etas);
    const nouveau = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: DATE_ENGAGEMENT_DEMO,
      inputs: { zoneClimatique: c.zone, surfaceChauffeeM2: c.surface, etasBande: c.etas },
    });
    const ok = nouveau.kwhCumac === ancien;
    assert(ok, `${c.label} : ancien=${ancien} kWhc, nouveau=${nouveau.kwhCumac} kWhc`);
    if (ok) paritesOk += 1;
  }
  assert(cas.length >= 10, `au moins 10 cas de parité testés (trouvé ${cas.length})`);
  assert(paritesOk === cas.length, `parité complète sur les ${cas.length} cas (${paritesOk} identiques)`);

  // ============================================================
  // TEST A (section 28) : frontière de date entre deux versions
  // ============================================================
  console.log("\n=== TEST A - frontière de date entre deux versions ===");
  const regleTest = await prisma.regleReglementaire.upsert({
    where: { code: "TEST-VERSIONING-A" },
    update: {},
    create: { code: "TEST-VERSIONING-A", famille: "TEST", secteur: "AUTRE", nom: "Règle de test versionnage" },
  });
  const versionAncienne = await prisma.regleReglementaireVersion.upsert({
    where: { regleId_numeroVersion: { regleId: regleTest.id, numeroVersion: "ancienne" } },
    update: {},
    create: {
      regleId: regleTest.id,
      numeroVersion: "ancienne",
      dateDebutEffet: new Date("2026-01-01"),
      dateFinEffet: new Date("2026-08-31"),
      publie: true,
      formulaCode: "BAR_TH_171_CUMAC_V1",
      sourceNom: "Test",
    },
  });
  const versionNouvelle = await prisma.regleReglementaireVersion.upsert({
    where: { regleId_numeroVersion: { regleId: regleTest.id, numeroVersion: "nouvelle" } },
    update: {},
    create: {
      regleId: regleTest.id,
      numeroVersion: "nouvelle",
      dateDebutEffet: new Date("2026-09-01"),
      dateFinEffet: null,
      publie: true,
      formulaCode: "BAR_TH_171_CUMAC_V1",
      sourceNom: "Test",
    },
  });
  {
    const versionPour31Aout = await getApplicableRuleVersion("TEST-VERSIONING-A", new Date("2026-08-31"));
    assert(versionPour31Aout?.id === versionAncienne.id, "dossier engagé le 31/08 -> ancienne version");
    const versionPour1Sept = await getApplicableRuleVersion("TEST-VERSIONING-A", new Date("2026-09-01"));
    assert(versionPour1Sept?.id === versionNouvelle.id, "dossier engagé le 01/09 -> nouvelle version");
  }

  // ============================================================
  // TEST B (section 28) : modifier la nouvelle version ne change pas un
  // calcul déjà enregistré avec l'ancienne
  // ============================================================
  console.log("\n=== TEST B - un calcul enregistré reste figé si la version évolue ===");
  {
    const resultAvant = await calculateCeeCumac({
      ficheCode: "TEST-VERSIONING-A",
      dateEngagement: new Date("2026-08-15"),
      inputs: {},
    });
    // "Modifier" la nouvelle version (dates, commentaire) - ne doit avoir
    // aucun effet sur un dossier déjà engagé sous l'ancienne version.
    await prisma.regleReglementaireVersion.update({
      where: { id: versionNouvelle.id },
      data: { commentaire: "Modifiée après coup pour le test B" },
    });
    const resultApres = await calculateCeeCumac({
      ficheCode: "TEST-VERSIONING-A",
      dateEngagement: new Date("2026-08-15"),
      inputs: {},
    });
    assert(resultAvant.ruleVersionId === resultApres.ruleVersionId, "même ruleVersionId avant/après modification de l'autre version");
    assert(resultApres.ruleVersionId === versionAncienne.id, "toujours l'ancienne version pour cette date d'engagement");
  }

  // ============================================================
  // SECTION 29 : tests d'éligibilité
  // ============================================================
  console.log("\n=== ÉLIGIBILITÉ ===");
  {
    const eligible = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: DATE_ENGAGEMENT_DEMO,
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
    });
    assert(eligible.statutEligibilite === "ELIGIBLE_PROBABLE", `dossier clairement éligible -> ELIGIBLE_PROBABLE (trouvé ${eligible.statutEligibilite})`);
    assert(eligible.kwhCumac === 458_640, "cumac correct pour ce cas éligible");

    const manquant = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: DATE_ENGAGEMENT_DEMO,
      inputs: { zoneClimatique: "H1" },
    });
    assert(manquant.statutEligibilite === "DONNEES_INSUFFISANTES", `donnée obligatoire absente -> DONNEES_INSUFFISANTES (trouvé ${manquant.statutEligibilite})`);
    assert(manquant.missingFields.includes("surfaceChauffeeM2") && manquant.missingFields.includes("etasBande"), "missingFields liste bien les champs manquants");

    const dateHorsPeriode = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: new Date("2020-01-01"),
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
    });
    assert(dateHorsPeriode.statutEligibilite === "DONNEES_INSUFFISANTES", `date hors période -> DONNEES_INSUFFISANTES (trouvé ${dateHorsPeriode.statutEligibilite})`);
    assert(dateHorsPeriode.ruleVersionId === null, "aucune version applicable retournée hors période");

    const sansDateEngagement = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: null,
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
    });
    assert(sansDateEngagement.statutEligibilite === "DONNEES_INSUFFISANTES", "aucune date d'engagement -> DONNEES_INSUFFISANTES");
    assert(sansDateEngagement.missingFields.includes("dateEngagement"), "dateEngagement listée comme champ manquant");

    assert(getDossierEngagementDate({ dateSignatureDevis: null }) === null, "getDossierEngagementDate retourne null si pas de date de signature");
    const dateTest = new Date("2026-03-01");
    assert(getDossierEngagementDate({ dateSignatureDevis: dateTest })?.getTime() === dateTest.getTime(), "getDossierEngagementDate retourne dateSignatureDevis quand présente");
  }

  // ============================================================
  // SECTION 30 : tests tarifs CEE
  // ============================================================
  console.log("\n=== TARIFS CEE ===");
  const orgTarif = await prisma.organisation.create({ data: { nom: "Test Tarifs CEE", slug: `test-tarifs-cee-${Date.now()}` } });
  const delegataireTest = await prisma.delegataireCee.create({ data: { nom: `Test Délégataire ${Date.now()}`, actif: true } });
  const delegataireTest2 = await prisma.delegataireCee.create({ data: { nom: `Test Délégataire 2 ${Date.now()}`, actif: true } });
  {
    // 100 MWhc à 74 €/MWhc = 7 400 €
    await prisma.tarifDelegataireCee.create({
      data: {
        organisationId: orgTarif.id,
        delegataireId: delegataireTest.id,
        ficheCode: "BAR-TH-171",
        categorie: "CLASSIQUE",
        tauxCtsParMwhc: 7_400, // 74,00 € en centimes
        dateDebut: new Date("2026-01-01"),
        dateFin: null,
        delaiPaiementJours: 45,
        actif: true,
      },
    });
    const valuation = await calculateCeeValuation({
      organisationId: orgTarif.id,
      kwhCumac: 100_000, // 100 MWhc
      delegataireId: delegataireTest.id,
      ficheCode: "BAR-TH-171",
      categorie: "CLASSIQUE",
      date: new Date("2026-06-01"),
    });
    assert(valuation?.mwhc === 100, `100 MWhc (trouvé ${valuation?.mwhc})`);
    assert(valuation?.primeCts === 740_000, `prime = 7 400 € (trouvé ${(valuation?.primeCts ?? 0) / 100} €)`);

    // Tarif hors période de validité
    const horsValidite = await calculateCeeValuation({
      organisationId: orgTarif.id,
      kwhCumac: 100_000,
      delegataireId: delegataireTest.id,
      ficheCode: "BAR-TH-171",
      categorie: "CLASSIQUE",
      date: new Date("2025-01-01"),
    });
    assert(horsValidite === null, "tarif hors période de validité -> null (pas de montant inventé)");

    // Catégorie différente non configurée
    const categorieAbsente = await calculateCeeValuation({
      organisationId: orgTarif.id,
      kwhCumac: 100_000,
      delegataireId: delegataireTest.id,
      ficheCode: "BAR-TH-171",
      categorie: "TRES_MODESTE",
      date: new Date("2026-06-01"),
    });
    assert(categorieAbsente === null, "catégorie sans tarif configuré -> null");

    // Tarif absent pour un autre délégataire
    const delegataireAbsent = await calculateCeeValuation({
      organisationId: orgTarif.id,
      kwhCumac: 100_000,
      delegataireId: delegataireTest2.id,
      ficheCode: "BAR-TH-171",
      categorie: "CLASSIQUE",
      date: new Date("2026-06-01"),
    });
    assert(delegataireAbsent === null, "tarif absent pour un délégataire non configuré -> null");

    // Plusieurs délégataires - comparateur
    await prisma.tarifDelegataireCee.create({
      data: {
        organisationId: orgTarif.id,
        delegataireId: delegataireTest2.id,
        ficheCode: "BAR-TH-171",
        categorie: "CLASSIQUE",
        tauxCtsParMwhc: 8_000, // 80 €/MWhc, meilleur taux mais délai plus long
        dateDebut: new Date("2026-01-01"),
        dateFin: null,
        delaiPaiementJours: 90,
        actif: true,
      },
    });
    const comparatif = await compareCeeDelegates({
      organisationId: orgTarif.id,
      kwhCumac: 100_000,
      ficheCode: "BAR-TH-171",
      categorie: "CLASSIQUE",
      date: new Date("2026-06-01"),
    });
    assert(comparatif.length === 2, `2 délégataires comparés (trouvé ${comparatif.length})`);
    assert(comparatif.every((c) => c.scoreQualiteAdministrative === null), "scoreQualiteAdministrative jamais fabriqué (toujours null en V1)");
  }

  // ============================================================
  // SECTION 31 : multi-tenant - tarifs propres à l'organisation
  // ============================================================
  console.log("\n=== MULTI-TENANT (tarifs) ===");
  {
    const orgB = await prisma.organisation.create({ data: { nom: "Test Tarifs CEE B", slug: `test-tarifs-cee-b-${Date.now()}` } });
    const valuationOrgB = await calculateCeeValuation({
      organisationId: orgB.id,
      kwhCumac: 100_000,
      delegataireId: delegataireTest.id,
      ficheCode: "BAR-TH-171",
      categorie: "CLASSIQUE",
      date: new Date("2026-06-01"),
    });
    assert(valuationOrgB === null, "le tarif de l'organisation A n'est pas visible depuis l'organisation B (tarifs commerciaux cloisonnés)");
    await prisma.organisation.delete({ where: { id: orgB.id } });
  }

  // ============================================================
  // SECTION 32 : permissions
  // ============================================================
  console.log("\n=== PERMISSIONS ===");
  {
    const admin: UserContext = { userId: "x", organisationId: orgTarif.id, role: "ADMIN" };
    const commercial: UserContext = { userId: "x", organisationId: orgTarif.id, role: "COMMERCIAL" };
    const regie: UserContext = { userId: "x", organisationId: orgTarif.id, role: "REGIE" };
    assert(hasPermission(admin, "MANAGE_REGLEMENTATION"), "ADMIN peut publier/modifier la réglementation");
    assert(!hasPermission(commercial, "MANAGE_REGLEMENTATION"), "COMMERCIAL ne peut pas modifier la réglementation");
    assert(hasPermission(commercial, "SIMULATE_REGLEMENTATION"), "COMMERCIAL peut simuler un calcul CEE");
    assert(!hasPermission(regie, "SIMULATE_REGLEMENTATION"), "RÉGIE n'a aucun accès réglementaire (comme en finance P6)");
  }

  // ============================================================
  // SECTION 23/24/29 : override (raison obligatoire) + TEST C (version publiée figée)
  // ============================================================
  console.log("\n=== OVERRIDE + TEST C (paramètres structurels figés) ===");
  {
    let leve = false;
    try {
      validateOverrideReason("");
    } catch {
      leve = true;
    }
    assert(leve, "override sans raison -> refusé");

    let leve2 = false;
    try {
      validateOverrideReason("   ");
    } catch {
      leve2 = true;
    }
    assert(leve2, "override avec une raison uniquement composée d'espaces -> refusé");

    const raisonValidee = validateOverrideReason("  Correction après contrôle terrain  ");
    assert(raisonValidee === "Correction après contrôle terrain", "override avec raison -> acceptée et nettoyée (trim)");

    let leve3 = false;
    try {
      assertRuleVersionEditable({ publie: true });
    } catch {
      leve3 = true;
    }
    assert(leve3, "TEST C : version publiée -> modification des paramètres structurels refusée");

    let leve4 = false;
    try {
      assertRuleVersionEditable({ publie: false });
    } catch {
      leve4 = true;
    }
    assert(!leve4, "version non publiée (brouillon) -> modification autorisée");
  }

  // ============================================================
  // SECTION 11 : calcul enregistré immuable
  // ============================================================
  console.log("\n=== CALCUL ENREGISTRÉ IMMUABLE ===");
  {
    const clientImmuable = await prisma.client.create({ data: { prenom: "Test", nom: "Immuable", organisationId: orgTarif.id } });
    const dossierImmuable = await prisma.dossier.create({
      data: {
        reference: `TEST-P7-IMMUABLE-${Math.random().toString(36).slice(2, 8)}`,
        clientId: clientImmuable.id,
        organisationId: orgTarif.id,
        typeId: (await prisma.dossierType.findFirstOrThrow()).id,
        statutId: (await prisma.dossierStatus.findFirstOrThrow()).id,
        montantDevisTTC: 1_000_000,
        dateSignatureDevis: DATE_ENGAGEMENT_DEMO,
      },
    });
    const posteImmuable = await prisma.dossierPosteTravaux.create({
      data: { dossierId: dossierImmuable.id, type: "PAC_AIR_EAU", surfaceM2: 80 },
    });

    const resultat1 = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: DATE_ENGAGEMENT_DEMO,
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
    });
    const calcul1 = await prisma.calculReglementaire.create({
      data: {
        organisationId: orgTarif.id,
        dossierId: dossierImmuable.id,
        posteTravauxId: posteImmuable.id,
        ruleVersionId: resultat1.ruleVersionId!,
        type: "OFFICIEL",
        dateEngagement: DATE_ENGAGEMENT_DEMO,
        inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 80, etasBande: "plus140" },
        resultat: {},
        kwhCumac: resultat1.kwhCumac,
        statutEligibilite: resultat1.statutEligibilite,
      },
    });
    await prisma.dossierPosteTravaux.update({ where: { id: posteImmuable.id }, data: { calculReglementaireActifId: calcul1.id, ficheReglementaireCode: "BAR-TH-171" } });

    // Un second calcul OFFICIEL (données modifiées) doit créer une NOUVELLE
    // ligne, jamais écraser calcul1.
    const resultat2 = await calculateCeeCumac({
      ficheCode: "BAR-TH-171",
      dateEngagement: DATE_ENGAGEMENT_DEMO,
      inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 120, etasBande: "plus140" },
    });
    const calcul2 = await prisma.calculReglementaire.create({
      data: {
        organisationId: orgTarif.id,
        dossierId: dossierImmuable.id,
        posteTravauxId: posteImmuable.id,
        ruleVersionId: resultat2.ruleVersionId!,
        type: "OFFICIEL",
        dateEngagement: DATE_ENGAGEMENT_DEMO,
        inputs: { zoneClimatique: "H1", surfaceChauffeeM2: 120, etasBande: "plus140" },
        resultat: {},
        kwhCumac: resultat2.kwhCumac,
        statutEligibilite: resultat2.statutEligibilite,
      },
    });
    await prisma.dossierPosteTravaux.update({ where: { id: posteImmuable.id }, data: { calculReglementaireActifId: calcul2.id } });

    const historique = await prisma.calculReglementaire.findMany({ where: { posteTravauxId: posteImmuable.id }, orderBy: { createdAt: "asc" } });
    assert(historique.length === 2, `les 2 calculs officiels existent dans l'historique (trouvé ${historique.length})`);

    const calcul1Relu = await prisma.calculReglementaire.findUniqueOrThrow({ where: { id: calcul1.id } });
    assert(calcul1Relu.kwhCumac === resultat1.kwhCumac, "le premier calcul n'a pas été modifié par le second (kwhCumac inchangé)");

    const posteRelu = await prisma.dossierPosteTravaux.findUniqueOrThrow({ where: { id: posteImmuable.id } });
    assert(posteRelu.calculReglementaireActifId === calcul2.id, "le pointeur \"calcul actif\" du poste pointe désormais vers le second calcul");
    assert(posteRelu.calculReglementaireActifId !== calcul1.id, "le premier calcul n'est plus le calcul actif, mais reste dans l'historique");

    // Nettoyage dédié (avant le nettoyage général ci-dessous) : clear le
    // pointeur calcul actif avant de supprimer le dossier (cascade vers
    // postesTravaux + calculsReglementaires).
    await prisma.dossierPosteTravaux.update({ where: { id: posteImmuable.id }, data: { calculReglementaireActifId: null } });
    await prisma.dossier.delete({ where: { id: dossierImmuable.id } });
    await prisma.client.delete({ where: { id: clientImmuable.id } });
  }

  // --- Nettoyage ---
  await prisma.tarifDelegataireCee.deleteMany({ where: { organisationId: orgTarif.id } });
  await prisma.delegataireCee.deleteMany({ where: { id: { in: [delegataireTest.id, delegataireTest2.id] } } });
  await prisma.organisation.delete({ where: { id: orgTarif.id } });
  await prisma.regleReglementaireVersion.deleteMany({ where: { regleId: regleTest.id } });
  await prisma.regleReglementaire.delete({ where: { id: regleTest.id } });

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
