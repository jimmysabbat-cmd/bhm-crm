import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// ============================================================
// P14.1 - Publie une nouvelle version (v2) du questionnaire global
// "QUALIFICATION_COMMERCIALE" (organisationId: null) ajoutant les 6
// questions "tronc commun" nécessaires à l'UI revenus interactive :
// catégorie déclarée, catégorie calculée, RFR, nombre de personnes, année
// de référence, type occupant.
//
// La v1 est PUBLIÉE et déjà répondue par de vraies sessions (ReponseQuestionnaire)
// - elle reste donc figée pour toujours (même gouvernance que
// RegleReglementaireVersion/ProgrammeVersion : jamais de modification d'une
// version déjà publiée). On clone donc TOUTES les questions/options/conditions
// existantes dans une v2, on y ajoute les 6 nouvelles, puis on publie v2.
// Les anciennes ReponseQuestionnaire restent pointées sur v1 (jamais migrées
// automatiquement), les nouvelles sessions utiliseront v2.
//
// Idempotent : si v2 existe déjà (même numeroVersion), le script s'arrête
// sans rien recréer.
// ============================================================

async function main() {
  const questionnaire = await prisma.questionnaire.findFirst({ where: { code: "QUALIFICATION_COMMERCIALE", organisationId: null } });
  if (!questionnaire) throw new Error('Questionnaire global "QUALIFICATION_COMMERCIALE" introuvable.');

  const v1 = await prisma.questionnaireVersion.findFirst({
    where: { questionnaireId: questionnaire.id, numeroVersion: 1 },
    include: { questions: { include: { options: true, conditionsAffichage: true } } },
  });
  if (!v1) throw new Error("Version 1 introuvable.");
  if (!v1.publiee) throw new Error("Version 1 non publiée - situation inattendue, arrêt par sécurité.");

  const existingV2 = await prisma.questionnaireVersion.findFirst({ where: { questionnaireId: questionnaire.id, numeroVersion: 2 } });
  if (existingV2) {
    console.log("Version 2 existe déjà (id=" + existingV2.id + ", publiee=" + existingV2.publiee + ") - rien à faire.");
    return;
  }

  const v2 = await prisma.questionnaireVersion.create({
    data: { questionnaireId: questionnaire.id, numeroVersion: 2, publiee: false },
  });

  // 1) Clone toutes les questions de v1 (sans les conditions pour l'instant - id différent).
  const oldToNewQuestionId = new Map<string, string>();
  for (const q of v1.questions) {
    const clone = await prisma.question.create({
      data: {
        questionnaireVersionId: v2.id,
        code: q.code,
        libelle: q.libelle,
        type: q.type,
        unite: q.unite,
        ordre: q.ordre,
        obligatoire: q.obligatoire,
        section: q.section,
        champMappe: q.champMappe,
        metierConcerne: q.metierConcerne,
        categorieImpact: q.categorieImpact,
        poidsCommercial: q.poidsCommercial,
      },
    });
    oldToNewQuestionId.set(q.id, clone.id);
    for (const opt of q.options) {
      await prisma.optionQuestion.create({ data: { questionId: clone.id, code: opt.code, libelle: opt.libelle, ordre: opt.ordre } });
    }
  }
  // 2) Clone les conditions d'affichage (référencées par code, jamais par id technique - cf. commentaire du modèle Question).
  for (const q of v1.questions) {
    for (const cond of q.conditionsAffichage) {
      const newQuestionId = oldToNewQuestionId.get(cond.questionId);
      const newDeclenchanteId = oldToNewQuestionId.get(cond.questionDeclenchanteId);
      if (!newQuestionId || !newDeclenchanteId) throw new Error("Clonage incohérent : question source introuvable.");
      await prisma.conditionQuestion.create({
        data: { questionId: newQuestionId, questionDeclenchanteId: newDeclenchanteId, valeurAttendue: cond.valeurAttendue },
      });
    }
  }

  console.log(`Cloné ${v1.questions.length} question(s) de v1 vers v2.`);

  // 3) Ajoute les 6 nouvelles questions "tronc commun" revenus/foyer.
  const ordreDepart = Math.max(0, ...v1.questions.map((q) => q.ordre)) + 10;

  const catDeclaree = await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "CATEGORIE_REVENUS_DECLAREE",
      libelle: "Catégorie de revenus déclarée par le client",
      type: "SINGLE_SELECT",
      ordre: ordreDepart,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.precarite",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });
  for (const [i, code] of ["TRES_MODESTE", "MODESTE", "INTERMEDIAIRE", "SUPERIEUR"].entries()) {
    await prisma.optionQuestion.create({ data: { questionId: catDeclaree.id, code, libelle: code.replace("_", " "), ordre: i } });
  }

  await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "NOMBRE_PERSONNES_FOYER",
      libelle: "Nombre de personnes dans le foyer",
      type: "NUMBER",
      ordre: ordreDepart + 1,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.nombrePersonnesFoyer",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });

  await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "REVENU_FISCAL_REFERENCE",
      libelle: "Revenu fiscal de référence (RFR)",
      type: "NUMBER",
      unite: "EUR",
      ordre: ordreDepart + 2,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.revenuFiscalReference",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });

  await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "ANNEE_REFERENCE_REVENU",
      libelle: "Année de référence du RFR",
      type: "NUMBER",
      ordre: ordreDepart + 3,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.anneeReferenceRevenu",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });

  const typeOccupant = await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "TYPE_OCCUPANT",
      libelle: "Type d'occupant",
      type: "SINGLE_SELECT",
      ordre: ordreDepart + 4,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.typeOccupant",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });
  for (const [i, code] of ["PROPRIETAIRE", "LOCATAIRE", "BAILLEUR"].entries()) {
    await prisma.optionQuestion.create({ data: { questionId: typeOccupant.id, code, libelle: code, ordre: i } });
  }

  const catCalculee = await prisma.question.create({
    data: {
      questionnaireVersionId: v2.id,
      code: "CATEGORIE_REVENUS_CALCULEE",
      libelle: "Catégorie de revenus calculée par le barème ANAH_REVENUS et confirmée par le télépro",
      type: "SINGLE_SELECT",
      ordre: ordreDepart + 5,
      obligatoire: false,
      section: "D_REVENUS",
      champMappe: "Client.precarite",
      categorieImpact: "PROGRAMME_AIDE",
    },
  });
  for (const [i, code] of ["TRES_MODESTE", "MODESTE", "INTERMEDIAIRE", "SUPERIEUR"].entries()) {
    await prisma.optionQuestion.create({ data: { questionId: catCalculee.id, code, libelle: code.replace("_", " "), ordre: i } });
  }

  console.log("6 questions revenus/foyer ajoutées : CATEGORIE_REVENUS_DECLAREE, NOMBRE_PERSONNES_FOYER, REVENU_FISCAL_REFERENCE, ANNEE_REFERENCE_REVENU, TYPE_OCCUPANT, CATEGORIE_REVENUS_CALCULEE.");

  // 4) Publie v2 (fige-la à son tour - gouvernance identique à v1).
  await prisma.questionnaireVersion.update({ where: { id: v2.id }, data: { publiee: true, publieeAt: new Date() } });
  console.log(`Version 2 publiée (id=${v2.id}).`);
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
