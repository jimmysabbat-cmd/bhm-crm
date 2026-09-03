import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  calculateBlockedAmountForDossier,
  calculateBlockedAmountByFlux,
  mouvementIsLate,
  mouvementJoursRetard,
} from "../src/lib/finance";
import { getNextBestActions } from "../src/lib/next-best-action";
import { markRelanceDone, evaluateRelanceRules } from "../src/lib/relances";

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
  // --- Fixtures throwaway (deux organisations, pour tester le cloisonnement) ---
  const orgA = await prisma.organisation.create({ data: { nom: "Test NBA A", slug: `test-nba-a-${Date.now()}` } });
  const orgB = await prisma.organisation.create({ data: { nom: "Test NBA B", slug: `test-nba-b-${Date.now()}` } });
  const type = await prisma.dossierType.findFirstOrThrow();
  const statut = await prisma.dossierStatus.findFirstOrThrow();
  const clientA = await prisma.client.create({ data: { prenom: "Test", nom: "NBA-A", organisationId: orgA.id } });
  const clientB = await prisma.client.create({ data: { prenom: "Test", nom: "NBA-B", organisationId: orgB.id } });

  const userAdmin = await prisma.user.create({
    data: { name: "Admin Test", email: `admin-nba-${Date.now()}@test.local`, password: "x", role: "ADMIN", organisationId: orgA.id },
  });
  const userCommercial = await prisma.user.create({
    data: { name: "Commercial Test", email: `commercial-nba-${Date.now()}@test.local`, password: "x", role: "COMMERCIAL", organisationId: orgA.id },
  });

  async function nouveauDossier(orgId: string, clientId: string, montants: { devis: number; mpr?: number; cee?: number; encClient?: number; encMpr?: number; encCee?: number }) {
    return prisma.dossier.create({
      data: {
        reference: `TEST-NBA-${Math.random().toString(36).slice(2, 8)}`,
        clientId,
        organisationId: orgId,
        typeId: type.id,
        statutId: statut.id,
        montantDevisTTC: montants.devis,
        montantAideMPR: montants.mpr ?? 0,
        montantAideCEE: montants.cee ?? 0,
        montantEncaisseClient: montants.encClient ?? 0,
        montantEncaisseMPR: montants.encMpr ?? 0,
        montantEncaisseCEE: montants.encCee ?? 0,
      },
    });
  }

  async function nouveauProgramme(orgId: string) {
    const programme = await prisma.programme.create({
      data: { organisationId: orgId, nom: "Prog NBA", code: `NBA-${Math.random().toString(36).slice(2, 8)}` },
    });
    return prisma.programmeVersion.create({ data: { programmeId: programme.id, numeroVersion: "1", publie: true } });
  }

  // ============================================================
  // TEST 1 : montant bloqué sans double-comptage (agrégats vs MouvementFinancier)
  // ============================================================
  console.log("\nTEST 1 - montant bloqué : pas de double-comptage");
  {
    // devis 10 000 €, MPR 3 000 € (rien encaissé), CEE 1 000 € (tout encaissé),
    // reste client = 10000 - 3000 - 1000 = 6000, encaissé client 2000 => reste 4000.
    const dossier = await nouveauDossier(orgA.id, clientA.id, {
      devis: 1_000_000, mpr: 300_000, cee: 100_000, encClient: 200_000, encMpr: 0, encCee: 100_000,
    });
    // Un mouvement ENCAISSEMENT_CLIENT en attente : catégorie déjà couverte par les
    // agrégats -> ne doit JAMAIS s'ajouter en plus du "Client restant" ci-dessus.
    await prisma.mouvementFinancier.create({
      data: { organisationId: orgA.id, dossierId: dossier.id, type: "ENTREE", categorie: "ENCAISSEMENT_CLIENT", montantPrevuCts: 400_000, datePrevue: daysAgo(3), statut: "PREVU" },
    });
    // Un mouvement PAIEMENT_SOUS_TRAITANT : catégorie NON couverte par les agrégats
    // -> doit bien s'ajouter comme ligne de détail distincte.
    await prisma.mouvementFinancier.create({
      data: { organisationId: orgA.id, dossierId: dossier.id, type: "SORTIE", categorie: "PAIEMENT_SOUS_TRAITANT", montantPrevuCts: 150_000, datePrevue: daysAgo(1), statut: "A_PAYER" },
    });

    const { montantBloqueCts, details } = await calculateBlockedAmountForDossier(dossier.id);
    assert(montantBloqueCts === 300_000 + 400_000 + 150_000, `montant bloqué total = 850 000 cts (trouvé ${montantBloqueCts})`);
    assert(details.length === 3, `3 lignes de détail (ANAH, Client, sous-traitant) - trouvé ${details.length}`);
    assert(
      details.filter((d) => d.origine.toLowerCase().includes("client")).length === 1,
      "le client n'apparaît qu'une seule fois (pas de double-comptage agrégat + mouvement)"
    );
  }

  // ============================================================
  // TEST 2 : agrégation par flux (ANAH/CEE/CLIENT/AUTRE)
  // ============================================================
  console.log("\nTEST 2 - calculateBlockedAmountByFlux par flux");
  {
    const parFlux = await calculateBlockedAmountByFlux(orgA.id);
    const anah = parFlux.find((f) => f.flux === "ANAH")!;
    const client = parFlux.find((f) => f.flux === "CLIENT")!;
    const autre = parFlux.find((f) => f.flux === "AUTRE")!;
    assert(anah.montantBloqueCts >= 300_000, `flux ANAH inclut bien le dossier du TEST 1 (${anah.montantBloqueCts} cts)`);
    assert(client.montantBloqueCts >= 400_000, `flux CLIENT inclut bien le dossier du TEST 1 (${client.montantBloqueCts} cts)`);
    assert(autre.montantBloqueCts >= 150_000, `flux AUTRE inclut le paiement sous-traitant non couvert (${autre.montantBloqueCts} cts)`);
  }

  // ============================================================
  // TEST 3 : document obligatoire manquant -> apparaît, puis disparaît une fois fourni
  // ============================================================
  console.log("\nTEST 3 - document manquant apparaît/disparaît");
  {
    const version = await nouveauProgramme(orgA.id);
    const etape = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "AUDIT", nom: "Audit", ordre: 0 },
    });
    await prisma.etapeDocumentRequis.create({ data: { etapeProgrammeId: etape.id, typeDocument: "AUDIT", obligatoire: true } });

    const dossier = await nouveauDossier(orgA.id, clientA.id, { devis: 500_000 });
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await prisma.dossierEtape.create({
      data: { organisationId: orgA.id, dossierId: dossier.id, etapeProgrammeId: etape.id, statut: "A_FAIRE", dateDisponible: new Date() },
    });

    const avant = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    assert(
      avant.some((a) => a.dossierId === dossier.id && a.typeAction === "DOCUMENT_MANQUANT"),
      "document AUDIT manquant apparaît dans les Next Best Actions"
    );

    await prisma.dossierDocument.create({
      data: { dossierId: dossier.id, type: "AUDIT", nomFichier: "audit.pdf", cheminFichier: "/tmp/audit.pdf", mimeType: "application/pdf", tailleOctets: 100 },
    });

    const apres = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    assert(
      !apres.some((a) => a.dossierId === dossier.id && a.typeAction === "DOCUMENT_MANQUANT"),
      "document AUDIT fourni -> l'action DOCUMENT_MANQUANT disparaît"
    );
  }

  // ============================================================
  // TEST 4 : idempotence - deux appels successifs ne dupliquent rien
  // ============================================================
  console.log("\nTEST 4 - getNextBestActions idempotent");
  {
    const liste1 = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    const liste2 = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    assert(liste1.length === liste2.length, `deux appels donnent le même nombre d'actions (${liste1.length} vs ${liste2.length})`);
    const ids1 = new Set(liste1.map((a) => a.id));
    const ids2 = new Set(liste2.map((a) => a.id));
    assert(ids1.size === liste1.length, "aucun id d'action dupliqué au sein d'un même appel");
    assert([...ids1].every((id) => ids2.has(id)), "les deux appels retournent exactement le même ensemble d'actions");
  }

  // ============================================================
  // TEST 5 : calcul du retard (ETAPE et TACHE)
  // ============================================================
  console.log("\nTEST 5 - calcul du retard");
  {
    const version = await nouveauProgramme(orgA.id);
    const etape = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "RET", nom: "Étape en retard", ordre: 0 },
    });
    const dossier = await nouveauDossier(orgA.id, clientA.id, { devis: 200_000 });
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await prisma.dossierEtape.create({
      data: {
        organisationId: orgA.id, dossierId: dossier.id, etapeProgrammeId: etape.id,
        statut: "A_FAIRE", dateDisponible: daysAgo(10), dateEcheance: daysAgo(4),
      },
    });
    await prisma.tache.create({
      data: { dossierId: dossier.id, type: "AUTRE", titre: "Tâche en retard", dateEcheance: daysAgo(2), statut: "A_FAIRE" },
    });

    const actions = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    const etapeAction = actions.find((a) => a.dossierId === dossier.id && a.typeAction === "ETAPE");
    const tacheAction = actions.find((a) => a.dossierId === dossier.id && a.typeAction === "TACHE");
    assert(etapeAction?.joursRetard === 4, `étape en retard de 4 jours (trouvé ${etapeAction?.joursRetard})`);
    assert(tacheAction?.joursRetard === 2, `tâche en retard de 2 jours (trouvé ${tacheAction?.joursRetard})`);
  }

  // ============================================================
  // TEST 6 : cloisonnement inter-organisations
  // ============================================================
  console.log("\nTEST 6 - cloisonnement inter-organisations");
  {
    await nouveauDossier(orgB.id, clientB.id, { devis: 900_000, mpr: 200_000 });
    const actionsA = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    const actionsB = await getNextBestActions({ organisationId: orgB.id, scope: "all" });
    assert(actionsA.every((a) => a.organisationId === orgA.id), "aucune action de l'org A n'appartient à l'org B");
    assert(actionsB.every((a) => a.organisationId === orgB.id), "aucune action de l'org B n'appartient à l'org A");
    assert(
      !actionsA.some((a) => actionsB.some((b) => b.id === a.id)),
      "aucun id d'action partagé entre les deux organisations"
    );
  }

  // ============================================================
  // TEST 7 : visibilité par rôle/utilisateur (scope "mine" vs "all")
  // ============================================================
  console.log("\nTEST 7 - visibilité par rôle/utilisateur");
  {
    const version = await nouveauProgramme(orgA.id);
    const etape = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "ASSIGN", nom: "Étape assignée", ordre: 0, roleResponsable: "COMMERCIAL" },
    });
    const dossier = await nouveauDossier(orgA.id, clientA.id, { devis: 300_000 });
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await prisma.dossierEtape.create({
      data: {
        organisationId: orgA.id, dossierId: dossier.id, etapeProgrammeId: etape.id,
        statut: "A_FAIRE", dateDisponible: new Date(), assignedUserId: userCommercial.id,
      },
    });

    const vueCommercial = await getNextBestActions({ organisationId: orgA.id, scope: "mine", userId: userCommercial.id, role: "COMMERCIAL" });
    const vueAdmin = await getNextBestActions({ organisationId: orgA.id, scope: "mine", userId: userAdmin.id, role: "ADMIN" });
    const vueGlobale = await getNextBestActions({ organisationId: orgA.id, scope: "all" });

    assert(vueCommercial.some((a) => a.dossierId === dossier.id && a.typeAction === "ETAPE"), "le commercial assigné voit son étape en vue 'mine'");
    assert(!vueAdmin.some((a) => a.sourceId === vueCommercial.find((x) => x.dossierId === dossier.id)?.sourceId), "un autre utilisateur ne voit pas cette étape en vue 'mine'");
    assert(vueGlobale.some((a) => a.dossierId === dossier.id && a.typeAction === "ETAPE"), "la vue globale ('all') voit l'étape quel que soit l'assigné");
  }

  // ============================================================
  // TEST 8 : evaluateRelanceRules - création + idempotence
  // ============================================================
  console.log("\nTEST 8 - evaluateRelanceRules idempotent");
  {
    const version = await nouveauProgramme(orgA.id);
    const etape = await prisma.etapeProgramme.create({
      data: { programmeVersionId: version.id, code: "INSTRUCTION_ANAH", nom: "Instruction ANAH", ordre: 0, typeFlux: "ANAH" },
    });
    const dossier = await nouveauDossier(orgA.id, clientA.id, { devis: 400_000 });
    await prisma.dossier.update({ where: { id: dossier.id }, data: { programmeVersionId: version.id } });
    await prisma.dossierEtape.create({
      data: { organisationId: orgA.id, dossierId: dossier.id, etapeProgrammeId: etape.id, statut: "A_FAIRE", dateDisponible: daysAgo(10) },
    });
    const regle = await prisma.regleRelance.create({
      data: { organisationId: orgA.id, nom: "Relance ANAH J+5", typeFlux: "ANAH", apresJours: 5, recurrenceJours: 7, maxRelances: 3 },
    });

    const r1 = await evaluateRelanceRules(orgA.id);
    const r2 = await evaluateRelanceRules(orgA.id);
    assert(r1.tachesCreees === 1, `première évaluation crée 1 tâche de relance (trouvé ${r1.tachesCreees})`);
    assert(r2.tachesCreees === 0, `deuxième évaluation ne recrée rien (trouvé ${r2.tachesCreees})`);
    const nbTaches = await prisma.tache.count({ where: { dossierId: dossier.id, regleRelanceId: regle.id } });
    assert(nbTaches === 1, `une seule tâche de relance existe en base pour cette étape (trouvé ${nbTaches})`);
  }

  // ============================================================
  // TEST 9 : markRelanceDone - compteur, prochaine date, AuditLog
  // ============================================================
  console.log("\nTEST 9 - markRelanceDone (compteur + audit)");
  {
    const tache = await prisma.tache.findFirstOrThrow({ where: { dossier: { organisationId: orgA.id }, regleRelanceId: { not: null } } });
    const avant = tache.nombreRelances;
    const { nombreRelances, prochaineRelanceAt } = await markRelanceDone({ tacheId: tache.id, organisationId: orgA.id, userId: userAdmin.id });
    assert(nombreRelances === avant + 1, `compteur incrémenté (${avant} -> ${nombreRelances})`);
    assert(prochaineRelanceAt !== null, "prochaine date de relance calculée (recurrenceJours défini sur la règle)");

    const tacheApres = await prisma.tache.findUniqueOrThrow({ where: { id: tache.id } });
    assert(tacheApres.derniereRelanceAt !== null, "derniereRelanceAt renseigné sur la tâche");

    const audit = await prisma.auditLog.findFirst({
      where: { organisationId: orgA.id, entityType: "Tache", entityId: tache.id, action: "RELANCE_EFFECTUEE" },
      orderBy: { createdAt: "desc" },
    });
    assert(audit !== null, "un AuditLog RELANCE_EFFECTUEE a bien été créé");
  }

  // ============================================================
  // TEST 10 : mouvementIsLate / mouvementJoursRetard + tri par priorité
  // ============================================================
  console.log("\nTEST 10 - retard mouvement financier + tri par priorité");
  {
    const enRetard = { statut: "A_PAYER" as const, datePrevue: daysAgo(5) };
    const aTemps = { statut: "A_PAYER" as const, datePrevue: daysFromNow(3) };
    const soldee = { statut: "PAYE" as const, datePrevue: daysAgo(5) };
    assert(mouvementIsLate(enRetard) === true, "mouvement dont la date prévue est passée et non soldé => en retard");
    assert(mouvementIsLate(aTemps) === false, "mouvement dont la date prévue est future => pas en retard");
    assert(mouvementIsLate(soldee) === false, "mouvement PAYE jamais compté en retard même si la date est passée");
    assert(mouvementJoursRetard(enRetard) === 5, `5 jours de retard (trouvé ${mouvementJoursRetard(enRetard)})`);

    const actions = await getNextBestActions({ organisationId: orgA.id, scope: "all" });
    const scoresTries = actions.every((a, i) => i === 0 || actions[i - 1].priorityScore >= a.priorityScore);
    assert(scoresTries, "les actions sont bien triées par priorityScore décroissant");
  }

  // --- Nettoyage ---
  await prisma.auditLog.deleteMany({ where: { organisationId: orgA.id } });
  await prisma.mouvementFinancier.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.tache.deleteMany({ where: { dossier: { organisationId: { in: [orgA.id, orgB.id] } } } });
  await prisma.dossierEtape.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.regleRelance.deleteMany({ where: { organisationId: orgA.id } });
  await prisma.dossierDocument.deleteMany({ where: { dossier: { organisationId: { in: [orgA.id, orgB.id] } } } });
  await prisma.dossier.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
  await prisma.etapeProgramme.deleteMany({ where: { programmeVersion: { programme: { organisationId: { in: [orgA.id, orgB.id] } } } } });
  await prisma.programmeVersion.deleteMany({ where: { programme: { organisationId: { in: [orgA.id, orgB.id] } } } });
  await prisma.programme.deleteMany({ where: { organisationId: { in: [orgA.id, orgB.id] } } });
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
