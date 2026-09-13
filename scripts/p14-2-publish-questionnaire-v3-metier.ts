import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// ============================================================
// P14.2 - Publie une version 3 du questionnaire global
// "QUALIFICATION_COMMERCIALE" (organisationId: null) : reprend v2 à
// l'identique (gouvernance figée, jamais modifiée - même principe que
// RegleReglementaireVersion), retague les questions PAC déjà existantes
// avec categorieImpact/metierConcerne pour le Next Best Question, ajoute
// les questions spécifiques ITE (branche métier générique - AUCUNE
// logique BHM/RUA) et une question tronc commun "besoin principal".
//
// Idempotent : si v3 existe déjà, le script s'arrête sans rien recréer.
// ============================================================

const PAC_QUESTION_TAGS: Record<string, { metierConcerne: string; categorieImpact: string }> = {
  // Tronc commun (metierConcerne "" -> null) : ces faits de base sont
  // nécessaires pour même commencer à détecter une opportunité - sans
  // tag, l'enum categorieImpact les traiterait à la priorité la PLUS
  // BASSE (moins prioritaire que COMMERCIAL), ce qui les faisait passer
  // après les questions revenus lors du test manuel. Corrigé en ELIGIBILITE
  // (juste après BLOQUANT_DECISION) puisqu'aucune opportunité ni catégorie
  // de revenus calculée par barème ne peut être évaluée sans ces données.
  TYPE_BATIMENT: { metierConcerne: "", categorieImpact: "ELIGIBILITE" },
  SURFACE_HABITABLE: { metierConcerne: "", categorieImpact: "ELIGIBILITE" },
  ANNEE_CONSTRUCTION: { metierConcerne: "", categorieImpact: "ELIGIBILITE" },
  ZONE_CLIMATIQUE: { metierConcerne: "", categorieImpact: "ELIGIBILITE" },
  NB_NIVEAUX: { metierConcerne: "", categorieImpact: "ELIGIBILITE" },
  CHAUFFAGE_ACTUEL: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "ELIGIBILITE" },
  CHAUDIERE_GAZ_CONDENSATION: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "CONFIRMATION_OPPORTUNITE" },
  AGE_CHAUDIERE_GAZ: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "TECHNIQUE_RDV" },
  CUVE_FIOUL: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "CONFIRMATION_OPPORTUNITE" },
  CONSO_FIOUL_APPROX: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "TECHNIQUE_RDV" },
  TYPE_PAC_EXISTANTE: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "CONFIRMATION_OPPORTUNITE" },
  AGE_PAC_EXISTANTE: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "TECHNIQUE_RDV" },
  PUISSANCE_PAC_EXISTANTE: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "TECHNIQUE_RDV" },
  EMETTEURS_PROJET: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "ELIGIBILITE" },
  ECS_INCLUS_PROJET: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "SCENARIO" },
  PUISSANCE_SOUHAITEE: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "TECHNIQUE_RDV" },
  SURFACE_CHAUFFEE: { metierConcerne: "PAC_AIR_EAU", categorieImpact: "SCENARIO" },
  // Partagée PAC/ITE (isolation) : reste sans metierConcerne unique - la
  // déduplication par champMappe (jamais par metierConcerne) permet à
  // n'importe quelle FicheMetier de la référencer sans la reposer.
  ISOLATION_MURS: { metierConcerne: "", categorieImpact: "CONFIRMATION_OPPORTUNITE" },
  COMBLES: { metierConcerne: "", categorieImpact: "CONFIRMATION_OPPORTUNITE" },
};

async function main() {
  const questionnaire = await prisma.questionnaire.findFirst({ where: { code: "QUALIFICATION_COMMERCIALE", organisationId: null } });
  if (!questionnaire) throw new Error('Questionnaire global "QUALIFICATION_COMMERCIALE" introuvable.');

  const v2 = await prisma.questionnaireVersion.findFirst({
    where: { questionnaireId: questionnaire.id, numeroVersion: 2 },
    include: { questions: { include: { options: true, conditionsAffichage: true } } },
  });
  if (!v2) throw new Error("Version 2 introuvable.");
  if (!v2.publiee) throw new Error("Version 2 non publiée - situation inattendue, arrêt par sécurité.");

  const existingV3 = await prisma.questionnaireVersion.findFirst({ where: { questionnaireId: questionnaire.id, numeroVersion: 3 } });
  if (existingV3) {
    console.log("Version 3 existe déjà (id=" + existingV3.id + ", publiee=" + existingV3.publiee + ") - rien à faire.");
    return;
  }

  const v3 = await prisma.questionnaireVersion.create({ data: { questionnaireId: questionnaire.id, numeroVersion: 3, publiee: false } });

  const oldToNewQuestionId = new Map<string, string>();
  for (const q of v2.questions) {
    const tag = PAC_QUESTION_TAGS[q.code];
    const clone = await prisma.question.create({
      data: {
        questionnaireVersionId: v3.id,
        code: q.code,
        libelle: q.libelle,
        type: q.type,
        unite: q.unite,
        ordre: q.ordre,
        obligatoire: q.obligatoire,
        section: q.section,
        champMappe: q.champMappe,
        metierConcerne: (tag ? tag.metierConcerne || null : q.metierConcerne) as never,
        categorieImpact: (tag?.categorieImpact as never) ?? q.categorieImpact,
        poidsCommercial: q.poidsCommercial,
      },
    });
    oldToNewQuestionId.set(q.id, clone.id);
    for (const opt of q.options) {
      await prisma.optionQuestion.create({ data: { questionId: clone.id, code: opt.code, libelle: opt.libelle, ordre: opt.ordre } });
    }
  }
  for (const q of v2.questions) {
    for (const cond of q.conditionsAffichage) {
      const newQuestionId = oldToNewQuestionId.get(cond.questionId);
      const newDeclenchanteId = oldToNewQuestionId.get(cond.questionDeclenchanteId);
      if (!newQuestionId || !newDeclenchanteId) throw new Error("Clonage incohérent : question source introuvable.");
      await prisma.conditionQuestion.create({ data: { questionId: newQuestionId, questionDeclenchanteId: newDeclenchanteId, valeurAttendue: cond.valeurAttendue } });
    }
  }
  console.log(`Cloné ${v2.questions.length} question(s) de v2 vers v3 (avec retag PAC).`);

  const ordreDepart = Math.max(0, ...v2.questions.map((q) => q.ordre)) + 20;

  // Branche ITE (générique - configuration, pas de nouveau moteur). Champs
  // volontairement NON mappés (champMappe: null) : ce sont des données
  // techniques de contexte, pas des champs Logement/Client déjà modélisés -
  // même précédent déjà en place pour plusieurs questions PAC (ex.
  // TYPE_PAC_EXISTANTE, EMETTEURS_PROJET). Elles sont capturées dans la
  // réponse et visibles dans la synthèse/fiche commerciale, sans participer
  // au calcul d'éligibilité tant qu'aucun champ dédié n'existe.
  const iteQuestions: Array<{ code: string; libelle: string; type: "YES_NO" | "SINGLE_SELECT" | "NUMBER" | "TEXT"; options?: string[]; categorieImpact: string }> = [
    { code: "ITE_MITOYENNETE", libelle: "Le logement est-il mitoyen ?", type: "YES_NO", categorieImpact: "ELIGIBILITE" },
    { code: "ITE_NOMBRE_FACADES", libelle: "Nombre de façades à isoler", type: "NUMBER", categorieImpact: "SCENARIO" },
    { code: "ITE_ACCES_FACADE", libelle: "Accès façade (échafaudage possible ?)", type: "SINGLE_SELECT", options: ["FACILE", "DIFFICILE", "A_VERIFIER_VISITE"], categorieImpact: "TECHNIQUE_RDV" },
    { code: "ITE_LIMITE_PROPRIETE", libelle: "Limite de propriété respectée ?", type: "SINGLE_SELECT", options: ["OUI", "NON", "A_VERIFIER_VISITE"], categorieImpact: "TECHNIQUE_RDV" },
    { code: "ITE_DOMAINE_PUBLIC", libelle: "Empiètement sur le domaine public ?", type: "YES_NO", categorieImpact: "ELIGIBILITE" },
    { code: "ITE_CONTRAINTES_CONNUES", libelle: "Contraintes connues (urbanisme, ABF, copropriété...)", type: "TEXT", categorieImpact: "TECHNIQUE_RDV" },
  ];
  for (const [i, q] of iteQuestions.entries()) {
    const created = await prisma.question.create({
      data: {
        questionnaireVersionId: v3.id,
        code: q.code,
        libelle: q.libelle,
        type: q.type,
        ordre: ordreDepart + i,
        obligatoire: false,
        section: "E_ITE",
        metierConcerne: "ITE",
        categorieImpact: q.categorieImpact as never,
      },
    });
    if (q.options) {
      for (const [oi, code] of q.options.entries()) {
        await prisma.optionQuestion.create({ data: { questionId: created.id, code, libelle: code.replace(/_/g, " "), ordre: oi } });
      }
    }
  }
  console.log(`${iteQuestions.length} question(s) ITE ajoutée(s).`);

  // Besoin principal (tronc commun, section 8) - influence uniquement le
  // classement commercial (categorieImpact COMMERCIAL), jamais
  // l'éligibilité réglementaire (audit section 8 : "jamais l'éligibilité").
  const besoin = await prisma.question.create({
    data: {
      questionnaireVersionId: v3.id,
      code: "BESOIN_PRINCIPAL",
      libelle: "Que recherche principalement le client ?",
      type: "MULTI_SELECT",
      ordre: ordreDepart + iteQuestions.length,
      obligatoire: false,
      section: "A_BESOIN",
      categorieImpact: "COMMERCIAL",
    },
  });
  const besoins = ["REDUIRE_FACTURES", "CHANGER_CHAUFFAGE", "AMELIORER_CONFORT", "ISOLER_MAISON", "AMELIORER_DPE", "CONNAITRE_AIDES", "PROJET_GLOBAL", "AUTRE"];
  for (const [i, code] of besoins.entries()) {
    await prisma.optionQuestion.create({ data: { questionId: besoin.id, code, libelle: code.replace(/_/g, " "), ordre: i } });
  }
  console.log("Question BESOIN_PRINCIPAL ajoutée.");

  await prisma.questionnaireVersion.update({ where: { id: v3.id }, data: { publiee: true, publieeAt: new Date() } });
  console.log(`Version 3 publiée (id=${v3.id}).`);
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
