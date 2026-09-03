import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalculateDossierWorkflow, calculerDelaiEtape } from "../src/lib/workflow";

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
  // --- Fixtures throwaway ---
  const org = await prisma.organisation.create({ data: { nom: "Test Engine", slug: `test-engine-${Date.now()}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const client = await prisma.client.create({ data: { prenom: "Test", nom: "Engine", organisationId: org.id } });

  async function nouveauDossier() {
    return prisma.dossier.create({
      data: {
        reference: `TEST-ENGINE-${Math.random().toString(36).slice(2, 8)}`,
        clientId: client.id,
        organisationId: org.id,
        typeId: type.id,
        statutId: statut.id,
        montantDevisTTC: 100000,
      },
    });
  }

  // ============================================================
  // TEST 1 : 3 étapes séquentielles - terminer étape 1 promeut étape 2
  // ============================================================
  console.log("\nTEST 1 - chaîne séquentielle simple");
  {
    const programme = await prisma.programme.create({
      data: { organisationId: org.id, nom: "Test1", code: `TEST1-${Date.now()}` },
    });
    const version = await prisma.programmeVersion.create({
      data: { programmeId: programme.id, numeroVersion: "1", publie: true },
    });
    const e1 = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "E1", nom: "Étape 1", ordre: 0 },
    });
    const e2 = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "E2", nom: "Étape 2", ordre: 1 },
    });
    const e3 = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "E3", nom: "Étape 3", ordre: 2 },
    });
    await prisma.etapeDependance.create({ data: { etapeId: e2.id, dependsOnEtapeId: e1.id } });
    await prisma.etapeDependance.create({ data: { etapeId: e3.id, dependsOnEtapeId: e2.id } });

    const dossier = await nouveauDossier();
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await recalculateDossierWorkflow(dossier.id);

    const etat1 = await prisma.dossierEtape.findMany({ where: { dossierId: dossier.id }, orderBy: { etapeProgramme: { ordre: "asc" } } });
    assert(etat1[0].statut === "A_FAIRE", "étape 1 = A_FAIRE dès l'instanciation");
    assert(etat1[1].statut === "NON_DISPONIBLE", "étape 2 = NON_DISPONIBLE avant que 1 soit terminée");
    assert(etat1[2].statut === "NON_DISPONIBLE", "étape 3 = NON_DISPONIBLE avant que 2 soit terminée");

    await prisma.dossierEtape.update({ where: { id: etat1[0].id }, data: { statut: "TERMINE", dateTerminee: new Date() } });
    await recalculateDossierWorkflow(dossier.id);

    const etat2 = await prisma.dossierEtape.findMany({ where: { dossierId: dossier.id }, orderBy: { etapeProgramme: { ordre: "asc" } } });
    assert(etat2[0].statut === "TERMINE", "étape 1 reste TERMINE");
    assert(etat2[1].statut === "A_FAIRE", "étape 2 devient A_FAIRE après que 1 soit terminée");
    assert(etat2[2].statut === "NON_DISPONIBLE", "étape 3 reste NON_DISPONIBLE (2 pas encore terminée)");
  }

  // ============================================================
  // TEST 2 : une étape dépend de DEUX étapes (ALL_COMPLETED)
  // ============================================================
  console.log("\nTEST 2 - dépendance à deux étapes (ALL_COMPLETED)");
  {
    const programme = await prisma.programme.create({
      data: { organisationId: org.id, nom: "Test2", code: `TEST2-${Date.now()}` },
    });
    const version = await prisma.programmeVersion.create({
      data: { programmeId: programme.id, numeroVersion: "1", publie: true },
    });
    const a = await prisma.etapeProgramme.create({ data: { programmeVersionId: version.id, code: "A", nom: "A", ordre: 0 } });
    const b = await prisma.etapeProgramme.create({ data: { programmeVersionId: version.id, code: "B", nom: "B", ordre: 1 } });
    const c = await prisma.etapeProgramme.create({ data: { programmeVersionId: version.id, code: "C", nom: "C dépend de A et B", ordre: 2 } });
    await prisma.etapeDependance.create({ data: { etapeId: c.id, dependsOnEtapeId: a.id } });
    await prisma.etapeDependance.create({ data: { etapeId: c.id, dependsOnEtapeId: b.id } });

    const dossier = await nouveauDossier();
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await recalculateDossierWorkflow(dossier.id);

    let etats = await prisma.dossierEtape.findMany({ where: { dossierId: dossier.id }, include: { etapeProgramme: true } });
    const deC = () => etats.find((e) => e.etapeProgramme.code === "C")!;
    assert(deC().statut === "NON_DISPONIBLE", "C non disponible tant que A et B ne sont pas terminées");

    const deA = etats.find((e) => e.etapeProgramme.code === "A")!;
    await prisma.dossierEtape.update({ where: { id: deA.id }, data: { statut: "TERMINE", dateTerminee: new Date() } });
    await recalculateDossierWorkflow(dossier.id);
    etats = await prisma.dossierEtape.findMany({ where: { dossierId: dossier.id }, include: { etapeProgramme: true } });
    assert(deC().statut === "NON_DISPONIBLE", "C toujours non disponible - seule A est terminée, pas B");

    const deB = etats.find((e) => e.etapeProgramme.code === "B")!;
    await prisma.dossierEtape.update({ where: { id: deB.id }, data: { statut: "TERMINE", dateTerminee: new Date() } });
    await recalculateDossierWorkflow(dossier.id);
    etats = await prisma.dossierEtape.findMany({ where: { dossierId: dossier.id }, include: { etapeProgramme: true } });
    assert(deC().statut === "A_FAIRE", "C devient A_FAIRE une fois A ET B terminées");
  }

  // ============================================================
  // TEST 3 : génération de tâche automatique idempotente (5 recalculs)
  // ============================================================
  console.log("\nTEST 3 - tâche automatique idempotente sur 5 recalculs");
  {
    const programme = await prisma.programme.create({
      data: { organisationId: org.id, nom: "Test3", code: `TEST3-${Date.now()}` },
    });
    const version = await prisma.programmeVersion.create({
      data: { programmeId: programme.id, numeroVersion: "1", publie: true },
    });
    const e1 = await prisma.etapeProgramme.create({ data: { programmeVersionId: version.id, code: "E1", nom: "Étape avec tâche auto", ordre: 0 } });
    await prisma.modeleTacheEtape.create({
      data: { etapeProgrammeId: e1.id, titre: "Tâche auto de test", type: "AUTRE", delaiJours: 5 },
    });

    const dossier = await nouveauDossier();
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });

    for (let i = 0; i < 5; i++) {
      await recalculateDossierWorkflow(dossier.id);
    }

    const taches = await prisma.tache.findMany({ where: { dossierId: dossier.id } });
    assert(taches.length === 1, `une seule tâche créée après 5 recalculs (trouvé ${taches.length})`);
    assert(taches[0]?.titre === "Tâche auto de test", "la tâche créée correspond au modèle");
  }

  // ============================================================
  // TEST 6 : modifier une NOUVELLE version ne touche pas un dossier
  //          engagé sur l'ancienne version
  // ============================================================
  console.log("\nTEST 6 - isolation entre versions d'un même programme");
  {
    const programme = await prisma.programme.create({
      data: { organisationId: org.id, nom: "Test6", code: `TEST6-${Date.now()}` },
    });
    const v1 = await prisma.programmeVersion.create({ data: { programmeId: programme.id, numeroVersion: "1", publie: true } });
    await prisma.etapeProgramme.create({ data: { programmeVersionId: v1.id, code: "E1", nom: "Étape v1", ordre: 0 } });

    const dossier = await nouveauDossier();
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: v1.id } });
    await recalculateDossierWorkflow(dossier.id);
    const avant = await prisma.dossierEtape.count({ where: { dossierId: dossier.id } });
    assert(avant === 1, "dossier a bien 1 DossierEtape instanciée depuis v1");

    // Nouvelle version du même programme, avec 3 étapes différentes - ne
    // doit avoir AUCUN effet sur le dossier déjà engagé sur v1.
    const v2 = await prisma.programmeVersion.create({ data: { programmeId: programme.id, numeroVersion: "2" } });
    await prisma.etapeProgramme.create({ data: { programmeVersionId: v2.id, code: "X1", nom: "X1", ordre: 0 } });
    await prisma.etapeProgramme.create({ data: { programmeVersionId: v2.id, code: "X2", nom: "X2", ordre: 1 } });
    await prisma.etapeProgramme.create({ data: { programmeVersionId: v2.id, code: "X3", nom: "X3", ordre: 2 } });

    await recalculateDossierWorkflow(dossier.id);
    const apres = await prisma.dossierEtape.count({ where: { dossierId: dossier.id } });
    assert(apres === 1, "le dossier reste à 1 DossierEtape - v2 n'a créé aucune instance pour lui");

    const dossierFinal = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert(dossierFinal.programmeVersionId === v1.id, "le dossier reste rattaché à v1, jamais changé automatiquement");
  }

  // ============================================================
  // TEST 7 : calcul du retard
  // ============================================================
  console.log("\nTEST 7 - calcul de retard");
  {
    const now = new Date();
    const enRetard = calculerDelaiEtape({
      dateDisponible: new Date(now.getTime() - 20 * 86_400_000),
      dateEcheance: new Date(now.getTime() - 7 * 86_400_000),
      statut: "A_FAIRE",
    });
    assert(enRetard.enRetard === true, "échéance passée + statut actif => enRetard = true");
    assert(enRetard.joursRetard === 7, `joursRetard = 7 (trouvé ${enRetard.joursRetard})`);

    const aTemps = calculerDelaiEtape({
      dateDisponible: new Date(now.getTime() - 2 * 86_400_000),
      dateEcheance: new Date(now.getTime() + 5 * 86_400_000),
      statut: "A_FAIRE",
    });
    assert(aTemps.enRetard === false, "échéance future => pas en retard");

    const termineeEnRetardIgnore = calculerDelaiEtape({
      dateDisponible: new Date(now.getTime() - 20 * 86_400_000),
      dateEcheance: new Date(now.getTime() - 7 * 86_400_000),
      statut: "TERMINE",
    });
    assert(termineeEnRetardIgnore.enRetard === false, "une étape TERMINE n'est jamais comptée en retard");
  }

  // --- Nettoyage (ordre important : Dossier référence ProgrammeVersion sans
  // cascade, donc les dossiers doivent partir avant les programmes) ---
  await prisma.dossier.deleteMany({ where: { organisationId: org.id } });
  await prisma.programme.deleteMany({ where: { organisationId: org.id } });
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
