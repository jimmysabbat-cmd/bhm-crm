import { prisma } from "@/lib/prisma";
import { getBlockingReasonsForEtape } from "@/lib/documents/blocking";
import type { Role } from "@/generated/prisma/enums";

// ============================================================
// Moteur de gates / conditions externes (P13, audit SaaS section D, révisé
// après relecture) - COMPLÈTE le moteur workflow existant, ne le remplace
// jamais :
// - une dépendance étape-à-étape reste EtapeDependance (src/lib/workflow.ts)
// - une exigence documentaire reste DocumentRequirement
//   (src/lib/documents/blocking.ts), jamais dupliquée ici.
//
// EtapeCondition (prisma/schema.prisma) ne couvre que ce que ces deux
// tables ne peuvent pas exprimer : une donnée déjà présente sur Dossier
// (DONNEE_DOSSIER, via un ENUM typé, jamais une chaîne libre) ou un fait
// attesté manuellement par un humain (VALIDATION_INTERVENANT). Aucun
// eval()/parser d'expression : le type détermine QUEL champ interpréter,
// et pour DONNEE_DOSSIER la clé doit obligatoirement exister dans
// DONNEE_DOSSIER_CHECKS ci-dessous (fail closed - une clé inconnue au
// niveau applicatif, si jamais introduite par erreur, n'est jamais
// considérée satisfaite).
//
// Définition (EtapeCondition) et état (DossierEtapeConditionValidation)
// sont deux tables strictement séparées - la définition ne contient jamais
// un statut de dossier, l'état ne contient jamais la règle.
// ============================================================

type DossierPourGates = {
  dateDepotAnah: Date | null;
  dateOctroiAnah: Date | null;
  statutAnahId: string | null;
  statutCeeId: string | null;
  statutTravauxId: string | null;
  dateDebutTravaux: Date | null;
  dateFinTravaux: Date | null;
};

const DOSSIER_GATE_SELECT = {
  dateDepotAnah: true,
  dateOctroiAnah: true,
  statutAnahId: true,
  statutCeeId: true,
  statutTravauxId: true,
  dateDebutTravaux: true,
  dateFinTravaux: true,
} as const;

// Vérifie délibérément des colonnes STRUCTURELLES de Dossier (dates/FK
// présents), jamais la VALEUR d'un référentiel paramétrable par le tenant
// (StatutAnah/StatutCee/StatutTravaux.key sont éditables depuis
// /parametrage - y comparer une gate réintroduirait exactement la
// fragilité "chaîne libre interprétée" que ce modèle doit éviter).
export const DONNEE_DOSSIER_CHECKS: Record<string, { label: string; check: (dossier: DossierPourGates) => boolean }> = {
  ANAH_DEPOT_EFFECTUE: { label: "Dépôt ANAH effectué", check: (d) => d.dateDepotAnah != null },
  ANAH_ACCORD_RECU: { label: "Accord ANAH reçu", check: (d) => d.dateOctroiAnah != null },
  ANAH_STATUT_RENSEIGNE: { label: "Statut ANAH renseigné", check: (d) => d.statutAnahId != null },
  CEE_STATUT_RENSEIGNE: { label: "Statut CEE renseigné", check: (d) => d.statutCeeId != null },
  TRAVAUX_STATUT_RENSEIGNE: { label: "Statut travaux renseigné", check: (d) => d.statutTravauxId != null },
  TRAVAUX_DEMARRES: { label: "Travaux démarrés", check: (d) => d.dateDebutTravaux != null },
  TRAVAUX_TERMINES: { label: "Travaux terminés", check: (d) => d.dateFinTravaux != null },
};

export function isKnownDonneeDossierCle(cle: string): boolean {
  return Object.prototype.hasOwnProperty.call(DONNEE_DOSSIER_CHECKS, cle);
}

export type GateReason = {
  source: "DOCUMENT" | "CONDITION";
  conditionId?: string;
  libelle: string;
};

type EtapeConditionRow = {
  id: string;
  type: string;
  donneeDossierCle: string | null;
  libelle: string;
};

async function isEtapeConditionSatisfied(condition: EtapeConditionRow, dossierId: string, dossier: DossierPourGates): Promise<boolean> {
  switch (condition.type) {
    case "DONNEE_DOSSIER": {
      if (!condition.donneeDossierCle) return false;
      const entry = DONNEE_DOSSIER_CHECKS[condition.donneeDossierCle];
      return entry ? entry.check(dossier) : false; // clé inconnue = jamais satisfaite (fail closed)
    }
    case "VALIDATION_INTERVENANT": {
      const validation = await prisma.dossierEtapeConditionValidation.findUnique({
        where: { etapeConditionId_dossierId: { etapeConditionId: condition.id, dossierId } },
      });
      return validation?.satisfiedAt != null;
    }
    default:
      return false;
  }
}

async function getConditionsForEtape(etapeProgrammeId: string, onlyBlocking: boolean) {
  return prisma.etapeCondition.findMany({
    where: onlyBlocking
      ? { etapeProgrammeId, actif: true, obligatoire: true, bloquant: true }
      : { etapeProgrammeId, actif: true },
    select: { id: true, type: true, donneeDossierCle: true, libelle: true },
  });
}

/**
 * EtapeCondition non satisfaites pour UNE étape et UN dossier - jamais les
 * documents (cf. getBlockingConditions ci-dessous pour la vue complète).
 * Séparée volontairement : détermine si une étape peut devenir DISPONIBLE
 * (isEtapeAccessible, utilisée par recalculateDossierWorkflow() dans
 * src/lib/workflow.ts), alors que les exigences documentaires bloquantes ne
 * bloquaient jusqu'ici QUE terminerEtape() (P10, comportement existant
 * volontairement inchangé pour les programmes qui n'utilisent aucune
 * EtapeCondition - zéro régression).
 */
async function getUnsatisfiedConditions(dossierId: string, etapeProgrammeId: string, organisationId: string, onlyBlocking: boolean): Promise<GateReason[]> {
  const [conditions, dossier] = await Promise.all([
    getConditionsForEtape(etapeProgrammeId, onlyBlocking),
    prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: DOSSIER_GATE_SELECT }),
  ]);
  if (!dossier || conditions.length === 0) return [];

  const reasons: GateReason[] = [];
  for (const condition of conditions) {
    const satisfait = await isEtapeConditionSatisfied(condition, dossierId, dossier);
    if (!satisfait) reasons.push({ source: "CONDITION", conditionId: condition.id, libelle: condition.libelle });
  }
  return reasons;
}

/**
 * Vrai si l'étape peut devenir DISPONIBLE : aucune EtapeCondition
 * obligatoire/bloquante en attente. Utilisée par recalculateDossierWorkflow()
 * en complément d'EtapeDependance (inchangée, jamais dupliquée ici).
 */
export async function isEtapeAccessible(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<boolean> {
  const reasons = await getUnsatisfiedConditions(dossierId, etapeProgrammeId, organisationId, true);
  return reasons.length === 0;
}

export async function isEtapeComplete(dossierEtapeId: string): Promise<boolean> {
  const de = await prisma.dossierEtape.findUnique({ where: { id: dossierEtapeId }, select: { statut: true } });
  return de?.statut === "TERMINE";
}

/**
 * Toutes les raisons de blocage d'UNE étape pour UN dossier - documents
 * (réutilise getBlockingReasonsForEtape existant tel quel, jamais dupliqué)
 * PLUS les EtapeCondition obligatoires/bloquantes non satisfaites. Fonction
 * centrale : terminerEtape() (src/app/dossiers/workflow-actions.ts) et
 * isReadyForProduction() ci-dessous l'utilisent tous les deux.
 */
export async function getBlockingConditions(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<GateReason[]> {
  const [docBlocages, conditionReasons] = await Promise.all([
    getBlockingReasonsForEtape(dossierId, etapeProgrammeId, organisationId),
    getUnsatisfiedConditions(dossierId, etapeProgrammeId, organisationId, true),
  ]);
  return [...docBlocages.map((b) => ({ source: "DOCUMENT" as const, libelle: b.typeDocumentNom })), ...conditionReasons];
}

/**
 * Toutes les EtapeCondition NON satisfaites pour une étape, qu'elles soient
 * bloquantes ou non (vue "ce qui reste à faire", plus large que
 * getBlockingConditions qui ne remonte que ce qui bloque réellement).
 */
export async function getPendingConditions(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<GateReason[]> {
  return getUnsatisfiedConditions(dossierId, etapeProgrammeId, organisationId, false);
}

/**
 * Résout une étape par son CODE (donnée du programme) plutôt que par son id
 * technique - permet à un appelant de demander "peut-on démarrer ENVOYER_EN_
 * POSE pour ce dossier" sans connaître d'id, et sans jamais coder le nom
 * d'un programme précis : le code est cherché dans la ProgrammeVersion
 * réellement affectée à CE dossier, quel que soit le programme.
 */
export async function canStartStep(dossierId: string, etapeCode: string, organisationId: string): Promise<boolean> {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { programmeVersionId: true } });
  if (!dossier?.programmeVersionId) return false;

  const etape = await prisma.etapeProgramme.findFirst({ where: { programmeVersionId: dossier.programmeVersionId, code: etapeCode }, select: { id: true } });
  if (!etape) return false;

  return isEtapeAccessible(dossierId, etape.id, organisationId);
}

/**
 * Vrai si toutes les étapes actives OBLIGATOIRES de la ProgrammeVersion du
 * dossier n'ont plus aucun blocage (documentaire ou condition) - la
 * définition générique de "prêt à produire" (audit SaaS section D/18) :
 * dérivée des données (Programme/EtapeProgramme/EtapeCondition), jamais un
 * `if (programme === "MaPrimeRénov") { ... }` codé en dur dans une page.
 *
 * FAIL-CLOSED (correction explicite demandée) : un dossier introuvable OU
 * sans programme affecté n'est JAMAIS "prêt par défaut" - un dossier destiné
 * à suivre un programme réglementaire/énergétique ne doit jamais devenir
 * prêt à produire uniquement parce qu'aucune ProgrammeVersion ne lui est
 * encore affectée. Aucun mode "production hors programme" n'existe
 * aujourd'hui dans le modèle - ne pas l'inventer ici tant qu'un vrai besoin
 * métier ne l'introduit pas explicitement au niveau du schéma.
 */
export async function isReadyForProduction(dossierId: string, organisationId: string): Promise<{ ready: boolean; blockingReasons: GateReason[] }> {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { programmeVersionId: true } });
  if (!dossier) return { ready: false, blockingReasons: [{ source: "CONDITION", libelle: "Dossier introuvable dans cette organisation." }] };
  if (!dossier.programmeVersionId) return { ready: false, blockingReasons: [{ source: "CONDITION", libelle: "Programme non affecté." }] };

  const etapes = await prisma.etapeProgramme.findMany({
    where: { programmeVersionId: dossier.programmeVersionId, actif: true, obligatoire: true },
    select: { id: true },
  });

  const allReasons: GateReason[] = [];
  for (const etape of etapes) {
    allReasons.push(...(await getBlockingConditions(dossierId, etape.id, organisationId)));
  }
  return { ready: allReasons.length === 0, blockingReasons: allReasons };
}

/**
 * Qui a le droit de valider manuellement une EtapeCondition
 * VALIDATION_INTERVENANT (P13, revue de sécurité explicite) - extrait en
 * fonction pure/testable (même principe qu'assertRuleVersionEditable en
 * P7, assertUsableAsPrincipalAdmin en P13-A) plutôt que gardé inline dans
 * validerConditionEtape(), pour être testé sans session réelle.
 *
 * - roleResponsable défini : seul ce rôle interne (ou ADMIN, qui garde son
 *   pouvoir d'override général déjà en place ailleurs dans P12) peut
 *   valider.
 * - partenaireRoleResponsable défini : seul un utilisateur RÉELLEMENT
 *   rattaché à un Partenaire possédant ce rôle (actif) peut valider - un
 *   ADMIN interne ne peut JAMAIS se substituer à l'attestation d'un
 *   partenaire (on ne peut pas fabriquer qu'un tiers externe a confirmé
 *   quelque chose, contrairement au cas interne ci-dessus).
 * - ni l'un ni l'autre défini : aucune restriction au-delà de
 *   l'appartenance à l'organisation (déjà vérifiée par l'appelant).
 */
export async function assertUserCanValidateCondition(
  condition: { roleResponsable: string | null; partenaireRoleResponsable: string | null },
  userId: string,
  effectiveRole: Role
): Promise<void> {
  if (condition.roleResponsable && effectiveRole !== condition.roleResponsable && effectiveRole !== "ADMIN") {
    throw new Error(`Seul le rôle ${condition.roleResponsable} (ou ADMIN) peut valider cette condition.`);
  }
  if (condition.partenaireRoleResponsable) {
    const acteur = await prisma.user.findUnique({ where: { id: userId }, select: { partenaireId: true } });
    const roleOk = acteur?.partenaireId
      ? await prisma.partenaireRole.findFirst({ where: { partenaireId: acteur.partenaireId, role: condition.partenaireRoleResponsable as never, actif: true } })
      : null;
    if (!roleOk) {
      throw new Error(`Seul un utilisateur rattaché à un partenaire ayant le rôle ${condition.partenaireRoleResponsable} peut valider cette condition.`);
    }
  }
}
