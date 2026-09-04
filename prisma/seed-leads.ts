import type { PrismaClient } from "../src/generated/prisma/client";

// ============================================================
// Données de paramétrage P9 (sources/pipeline/résultats + questionnaire de
// qualification par défaut). Séparé de seed.ts sur le même principe que
// seed-reglementaire.ts : un domaine, un fichier, importé depuis main().
// ============================================================

const LEAD_SOURCES = [
  { key: "TELEPROSPECTION", label: "Téléprospection" },
  { key: "IMPORT", label: "Import" },
  { key: "FOURNISSEUR_LEADS", label: "Fournisseur de leads" },
  { key: "SITE_WEB", label: "Site web" },
  { key: "REGIE", label: "Régie" },
  { key: "APPORTEUR", label: "Apporteur d'affaires" },
  { key: "COMMERCIAL", label: "Commercial (prospection terrain)" },
  { key: "PARRAINAGE", label: "Parrainage" },
  { key: "AUTRE", label: "Autre" },
];

// Section 3 - pipeline commercial, distinct du workflow administratif
// ANAH/CEE/Travaux (StatutAnah/StatutCee/StatutTravaux).
const LEAD_PIPELINE_STATUSES = [
  { key: "NOUVEAU", label: "Nouveau" },
  { key: "A_CONTACTER", label: "À contacter" },
  { key: "CONTACTE", label: "Contacté" },
  { key: "A_RAPPELER", label: "À rappeler" },
  { key: "QUALIFIE", label: "Qualifié" },
  { key: "RDV_PRIS", label: "RDV pris" },
  { key: "VISITE_EFFECTUEE", label: "Visite effectuée" },
  { key: "ETUDE_A_FAIRE", label: "Étude à faire" },
  { key: "ETUDE_FAITE", label: "Étude faite" },
  { key: "DEVIS_A_ENVOYER", label: "Devis à envoyer" },
  { key: "DEVIS_ENVOYE", label: "Devis envoyé" },
  { key: "NEGOCIATION", label: "Négociation" },
  { key: "SIGNE", label: "Signé" },
  { key: "PERDU", label: "Perdu" },
  { key: "INJOIGNABLE", label: "Injoignable" },
];

// Section 18 - chaque résultat peut proposer un enchaînement (nouveau
// statut + délai de rappel), appliqué par défaut par recordInteraction()
// sauf si l'utilisateur choisit un statut différent explicitement.
const RESULTATS_APPEL = [
  { key: "QUALIFIE", label: "Qualifié", proposeStatut: "QUALIFIE", delaiRappelJours: null },
  { key: "RDV_PRIS", label: "RDV pris", proposeStatut: "RDV_PRIS", delaiRappelJours: null },
  { key: "A_RAPPELER", label: "À rappeler", proposeStatut: "A_RAPPELER", delaiRappelJours: 1 },
  { key: "PAS_INTERESSE", label: "Pas intéressé", proposeStatut: "PERDU", delaiRappelJours: null },
  { key: "INJOIGNABLE", label: "Injoignable", proposeStatut: "INJOIGNABLE", delaiRappelJours: 2 },
  { key: "FAUX_NUMERO", label: "Faux numéro", proposeStatut: "PERDU", delaiRappelJours: null },
  { key: "DEJA_EQUIPE", label: "Déjà équipé", proposeStatut: "PERDU", delaiRappelJours: null },
  { key: "LOCATAIRE", label: "Locataire (non éligible)", proposeStatut: "PERDU", delaiRappelJours: null },
  { key: "HORS_CIBLE", label: "Hors cible", proposeStatut: "PERDU", delaiRappelJours: null },
  { key: "AUTRE", label: "Autre", proposeStatut: null, delaiRappelJours: null },
];

export async function seedLeadReferentiels(prisma: PrismaClient) {
  for (let i = 0; i < LEAD_SOURCES.length; i++) {
    const item = LEAD_SOURCES[i];
    await prisma.leadSource.upsert({ where: { key: item.key }, update: { label: item.label }, create: { key: item.key, label: item.label, ordre: i } });
  }
  for (let i = 0; i < LEAD_PIPELINE_STATUSES.length; i++) {
    const item = LEAD_PIPELINE_STATUSES[i];
    await prisma.leadPipelineStatus.upsert({ where: { key: item.key }, update: { label: item.label }, create: { key: item.key, label: item.label, ordre: i } });
  }
  for (let i = 0; i < RESULTATS_APPEL.length; i++) {
    const item = RESULTATS_APPEL[i];
    const proposeStatut = item.proposeStatut ? await prisma.leadPipelineStatus.findUniqueOrThrow({ where: { key: item.proposeStatut } }) : null;
    await prisma.resultatAppel.upsert({
      where: { key: item.key },
      update: { label: item.label, proposeStatutId: proposeStatut?.id ?? null, proposeDelaiRappelJours: item.delaiRappelJours },
      create: { key: item.key, label: item.label, ordre: i, proposeStatutId: proposeStatut?.id ?? null, proposeDelaiRappelJours: item.delaiRappelJours },
    });
  }

  console.log("Référentiels leads prêts (sources, pipeline, résultats d'appel).");
}

// --- Questionnaire de qualification par défaut (sections 6/7/8) --------
//
// Une seule question par ligne : code (stable, réutilisé par les
// conditions et le mapping), section d'écran, type, éventuelle unité,
// options (si select), champMappe (convention "Logement.x"/"Client.x"/
// "Projet.typeTravauxSouhaite"), et condition ([codeDeclencheur, valeur]).
type QuestionSeed = {
  code: string;
  section: string;
  libelle: string;
  type: "TEXT" | "NUMBER" | "YES_NO" | "SINGLE_SELECT" | "MULTI_SELECT" | "DATE";
  unite?: string;
  obligatoire?: boolean;
  options?: { code: string; libelle: string }[];
  champMappe?: string;
  condition?: { code: string; valeur: string };
};

const QUESTIONS_QUALIFICATION: QuestionSeed[] = [
  // --- B. LOGEMENT ---
  { code: "TYPE_BATIMENT", section: "B_LOGEMENT", libelle: "Type de bâtiment", type: "SINGLE_SELECT", obligatoire: true, champMappe: "Logement.typeBatiment", options: [{ code: "MAISON", libelle: "Maison" }, { code: "APPARTEMENT", libelle: "Appartement" }] },
  { code: "SURFACE_HABITABLE", section: "B_LOGEMENT", libelle: "Surface habitable", type: "NUMBER", unite: "m²", obligatoire: true, champMappe: "Logement.surfaceHabitableM2" },
  { code: "ANNEE_CONSTRUCTION", section: "B_LOGEMENT", libelle: "Année de construction", type: "NUMBER", unite: "année", champMappe: "Logement.anneeConstruction" },
  { code: "ZONE_CLIMATIQUE", section: "B_LOGEMENT", libelle: "Zone climatique", type: "SINGLE_SELECT", champMappe: "Client.zoneClimatique", options: [{ code: "H1", libelle: "H1" }, { code: "H2", libelle: "H2" }, { code: "H3", libelle: "H3" }] },
  { code: "PRECARITE", section: "B_LOGEMENT", libelle: "Niveau de revenus (précarité énergétique)", type: "SINGLE_SELECT", champMappe: "Client.precarite", options: [{ code: "TRES_MODESTE", libelle: "Très modeste" }, { code: "MODESTE", libelle: "Modeste" }, { code: "INTERMEDIAIRE", libelle: "Intermédiaire" }, { code: "SUPERIEUR", libelle: "Supérieur" }] },
  { code: "NB_NIVEAUX", section: "B_LOGEMENT", libelle: "Nombre d'étages", type: "NUMBER", champMappe: "Logement.nombreNiveaux", condition: { code: "TYPE_BATIMENT", valeur: "MAISON" } },
  { code: "COMBLES", section: "B_LOGEMENT", libelle: "Combles", type: "SINGLE_SELECT", champMappe: "Logement.isolationCombles", condition: { code: "TYPE_BATIMENT", valeur: "MAISON" }, options: [{ code: "AMENAGES_ISOLES", libelle: "Aménagés et isolés" }, { code: "PERDUS_ISOLES", libelle: "Perdus isolés" }, { code: "PERDUS_NON_ISOLES", libelle: "Perdus non isolés" }, { code: "AUCUN", libelle: "Aucun" }] },
  { code: "ISOLATION_MURS", section: "B_LOGEMENT", libelle: "Murs isolés ?", type: "SINGLE_SELECT", champMappe: "Logement.isolationMurs", condition: { code: "TYPE_BATIMENT", valeur: "MAISON" }, options: [{ code: "OUI", libelle: "Oui" }, { code: "NON", libelle: "Non" }, { code: "NE_SAIT_PAS", libelle: "Ne sait pas" }] },

  // --- C. CHAUFFAGE ACTUEL ---
  { code: "CHAUFFAGE_ACTUEL", section: "C_CHAUFFAGE", libelle: "Chauffage actuel", type: "SINGLE_SELECT", obligatoire: true, champMappe: "Logement.chauffagePrincipal", options: [{ code: "ELECTRICITE", libelle: "Électricité" }, { code: "GAZ", libelle: "Gaz" }, { code: "FIOUL", libelle: "Fioul" }, { code: "BOIS", libelle: "Bois" }, { code: "PAC", libelle: "Pompe à chaleur" }, { code: "RESEAU_CHALEUR", libelle: "Réseau de chaleur" }, { code: "AUTRE", libelle: "Autre" }] },
  { code: "CHAUDIERE_GAZ_CONDENSATION", section: "C_CHAUFFAGE", libelle: "Chaudière à condensation ?", type: "YES_NO", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "GAZ" } },
  { code: "AGE_CHAUDIERE_GAZ", section: "C_CHAUFFAGE", libelle: "Âge de la chaudière", type: "NUMBER", unite: "année", champMappe: "Logement.anneeEquipementChauffage", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "GAZ" } },
  { code: "CUVE_FIOUL", section: "C_CHAUFFAGE", libelle: "Cuve à fioul présente ?", type: "YES_NO", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "FIOUL" } },
  { code: "CONSO_FIOUL_APPROX", section: "C_CHAUFFAGE", libelle: "Consommation fioul approximative", type: "NUMBER", unite: "L/an", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "FIOUL" } },
  { code: "TYPE_PAC_EXISTANTE", section: "C_CHAUFFAGE", libelle: "Type de PAC existante", type: "SINGLE_SELECT", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "PAC" }, options: [{ code: "AIR_EAU", libelle: "Air/eau" }, { code: "AIR_AIR", libelle: "Air/air" }] },
  { code: "AGE_PAC_EXISTANTE", section: "C_CHAUFFAGE", libelle: "Âge de la PAC existante", type: "NUMBER", unite: "année", champMappe: "Logement.anneeEquipementChauffage", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "PAC" } },
  { code: "PUISSANCE_PAC_EXISTANTE", section: "C_CHAUFFAGE", libelle: "Puissance de la PAC existante (si connue)", type: "NUMBER", unite: "kW", condition: { code: "CHAUFFAGE_ACTUEL", valeur: "PAC" } },

  // --- D. TRAVAUX / BESOINS ---
  { code: "PROJET_TYPE_TRAVAUX", section: "D_TRAVAUX", libelle: "Projet de travaux souhaité", type: "SINGLE_SELECT", obligatoire: true, champMappe: "Projet.typeTravauxSouhaite", options: [{ code: "PAC_AIR_EAU", libelle: "Pompe à chaleur air/eau" }, { code: "AUTRE", libelle: "Autre / pas encore défini" }] },
  { code: "EMETTEURS_PROJET", section: "D_TRAVAUX", libelle: "Émetteurs prévus", type: "SINGLE_SELECT", condition: { code: "PROJET_TYPE_TRAVAUX", valeur: "PAC_AIR_EAU" }, options: [{ code: "RADIATEURS", libelle: "Radiateurs" }, { code: "PLANCHER_CHAUFFANT", libelle: "Plancher chauffant" }, { code: "MIXTE", libelle: "Mixte" }] },
  { code: "ECS_INCLUS_PROJET", section: "D_TRAVAUX", libelle: "ECS incluse dans le projet ?", type: "YES_NO", champMappe: "Logement.ecs", condition: { code: "PROJET_TYPE_TRAVAUX", valeur: "PAC_AIR_EAU" } },
  { code: "PUISSANCE_SOUHAITEE", section: "D_TRAVAUX", libelle: "Puissance souhaitée (si connue)", type: "NUMBER", unite: "kW", condition: { code: "PROJET_TYPE_TRAVAUX", valeur: "PAC_AIR_EAU" } },

  // --- E. ÉLIGIBILITÉ / DONNÉES UTILES ---
  { code: "SURFACE_CHAUFFEE", section: "E_ELIGIBILITE", libelle: "Surface chauffée", type: "NUMBER", unite: "m²", obligatoire: true, champMappe: "Logement.surfaceChauffeeM2" },
  { code: "ETAS_BANDE", section: "E_ELIGIBILITE", libelle: "Étiquette ETAS du logement (si connue)", type: "SINGLE_SELECT", options: [{ code: "111a140", libelle: "111 % ≤ ETAS < 140 %" }, { code: "plus140", libelle: "ETAS ≥ 140 %" }, { code: "NE_SAIT_PAS", libelle: "Ne sait pas" }] },
];

export async function seedQuestionnaireQualification(prisma: PrismaClient) {
  // Pas d'upsert sur (organisationId, code) : organisationId est nullable
  // pour un questionnaire global et MySQL ne garantit pas l'unicité d'un
  // couple contenant NULL au niveau index - on cherche donc explicitement
  // avant de créer, en cohérence avec la vérification "déjà publié" juste
  // après (idempotence assurée par la logique applicative, pas par l'index).
  let questionnaire = await prisma.questionnaire.findFirst({ where: { organisationId: null, code: "QUALIFICATION_COMMERCIALE" } });
  if (!questionnaire) {
    questionnaire = await prisma.questionnaire.create({ data: { organisationId: null, code: "QUALIFICATION_COMMERCIALE", nom: "Qualification commerciale" } });
  }

  const existing = await prisma.questionnaireVersion.findFirst({ where: { questionnaireId: questionnaire.id, publiee: true } });
  if (existing) {
    console.log("Questionnaire de qualification déjà publié (version existante conservée, jamais modifiée) - ordre", existing.numeroVersion);
    return;
  }

  const version = await prisma.questionnaireVersion.create({
    data: { questionnaireId: questionnaire.id, numeroVersion: 1, publiee: true, publieeAt: new Date() },
  });

  const questionIdByCode: Record<string, string> = {};
  for (let i = 0; i < QUESTIONS_QUALIFICATION.length; i++) {
    const q = QUESTIONS_QUALIFICATION[i];
    const created = await prisma.question.create({
      data: {
        questionnaireVersionId: version.id,
        code: q.code,
        libelle: q.libelle,
        type: q.type,
        unite: q.unite ?? null,
        ordre: i,
        obligatoire: q.obligatoire ?? false,
        section: q.section,
        champMappe: q.champMappe ?? null,
        options: q.options ? { create: q.options.map((o, oi) => ({ code: o.code, libelle: o.libelle, ordre: oi })) } : undefined,
      },
    });
    questionIdByCode[q.code] = created.id;
  }

  for (const q of QUESTIONS_QUALIFICATION) {
    if (!q.condition) continue;
    await prisma.conditionQuestion.create({
      data: {
        questionId: questionIdByCode[q.code],
        questionDeclenchanteId: questionIdByCode[q.condition.code],
        valeurAttendue: q.condition.valeur,
      },
    });
  }

  console.log(`Questionnaire de qualification publié (version ${version.numeroVersion}, ${QUESTIONS_QUALIFICATION.length} questions).`);
}
