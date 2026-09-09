import { prisma } from "@/lib/prisma";
import { getBlockingReasonsForEtape } from "@/lib/documents/blocking";

// ============================================================
// Moteur de gates / conditions externes (P13, audit SaaS section D) - ÉTEND
// le moteur workflow existant (EtapeDependance dans src/lib/workflow.ts,
// DocumentRequirement/getBlockingReasonsForEtape dans
// src/lib/documents/blocking.ts), n'en crée jamais un troisième. Une
// EtapeCondition exprime une dépendance qu'EtapeDependance seule ne peut
// pas exprimer (statut métier externe au moteur de programme, ou
// validation humaine explicite), jamais via eval()/expression libre : le
// type détermine QUEL champ interpréter, et pour STATUT_EXTERNE la clé doit
// obligatoirement exister dans STATUT_EXTERNE_CHECKS ci-dessous (fail
// closed - une clé inconnue n'est JAMAIS considérée satisfaite).
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

// Ajouter une nouvelle clé nécessite un commit développeur (même principe
// que formulaCode en P7 - un choix de sécurité assumé, pas un oubli) :
// jamais de champ arbitraire saisi depuis l'UI et interprété dynamiquement.
export const STATUT_EXTERNE_CHECKS: Record<string, { label: string; check: (dossier: DossierPourGates) => boolean }> = {
  ANAH_DEPOT_EFFECTUE: { label: "Dépôt ANAH effectué", check: (d) => d.dateDepotAnah != null },
  ANAH_ACCORD_RECU: { label: "Accord ANAH reçu", check: (d) => d.dateOctroiAnah != null },
  ANAH_STATUT_RENSEIGNE: { label: "Statut ANAH renseigné", check: (d) => d.statutAnahId != null },
  CEE_STATUT_RENSEIGNE: { label: "Statut CEE renseigné", check: (d) => d.statutCeeId != null },
  TRAVAUX_STATUT_RENSEIGNE: { label: "Statut travaux renseigné", check: (d) => d.statutTravauxId != null },
  TRAVAUX_DEMARRES: { label: "Travaux démarrés", check: (d) => d.dateDebutTravaux != null },
  TRAVAUX_TERMINES: { label: "Travaux terminés", check: (d) => d.dateFinTravaux != null },
};

export function isKnownStatutExterneCle(cle: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATUT_EXTERNE_CHECKS, cle);
}

export type GateBlockingReason = {
  source: "DOCUMENT" | "CONDITION";
  conditionId?: string;
  libelle: string;
};

type EtapeConditionRow = {
  id: string;
  type: string;
  dependsOnEtapeId: string | null;
  statutExterneCle: string | null;
  libelle: string;
};

async function isEtapeConditionSatisfied(
  condition: EtapeConditionRow,
  dossierId: string,
  dossier: DossierPourGates,
  statutParEtapeId: Map<string, string>
): Promise<boolean> {
  switch (condition.type) {
    case "DEPENDANCE_ETAPE": {
      if (!condition.dependsOnEtapeId) return true;
      return statutParEtapeId.get(condition.dependsOnEtapeId) === "TERMINE";
    }
    case "STATUT_EXTERNE": {
      if (!condition.statutExterneCle) return false;
      const entry = STATUT_EXTERNE_CHECKS[condition.statutExterneCle];
      return entry ? entry.check(dossier) : false;
    }
    case "VALIDATION_INTERVENANT": {
      const validation = await prisma.dossierEtapeConditionValidation.findUnique({
        where: { etapeConditionId_dossierId: { etapeConditionId: condition.id, dossierId } },
      });
      return validation?.satisfiedAt != null;
    }
    // DOCUMENT_REQUIS est déjà couvert par getBlockingReasonsForEtape
    // (appelé séparément dans getGateBlockingReasons) - jamais dupliqué ici.
    case "DOCUMENT_REQUIS":
    default:
      return true;
  }
}

/**
 * EtapeCondition obligatoires/bloquantes non satisfaites pour UNE étape et
 * UN dossier - jamais les documents (cf. getGateBlockingReasons ci-dessous
 * pour la vue complète). Séparée volontairement : sert à déterminer si une
 * étape peut devenir DISPONIBLE (isEtapeAccessible, utilisée par
 * recalculateDossierWorkflow() dans src/lib/workflow.ts), alors que les
 * exigences documentaires bloquantes ne bloquaient jusqu'ici QUE
 * terminerEtape() (P10, comportement existant volontairement inchangé pour
 * les programmes qui n'utilisent aucune EtapeCondition - zéro régression).
 */
export async function getExternalConditionReasons(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<GateBlockingReason[]> {
  const [conditions, dossier] = await Promise.all([
    prisma.etapeCondition.findMany({
      where: { etapeProgrammeId, actif: true, obligatoire: true, bloquant: true, type: { not: "DOCUMENT_REQUIS" } },
      select: { id: true, type: true, dependsOnEtapeId: true, statutExterneCle: true, libelle: true },
    }),
    prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: DOSSIER_GATE_SELECT }),
  ]);

  if (!dossier || conditions.length === 0) return [];

  const dependsOnIds = conditions.map((c) => c.dependsOnEtapeId).filter((id): id is string => id != null);
  const dossierEtapes =
    dependsOnIds.length > 0
      ? await prisma.dossierEtape.findMany({ where: { dossierId, etapeProgrammeId: { in: dependsOnIds } }, select: { etapeProgrammeId: true, statut: true } })
      : [];
  const statutParEtapeId = new Map(dossierEtapes.map((de) => [de.etapeProgrammeId, de.statut as string]));

  const reasons: GateBlockingReason[] = [];
  for (const condition of conditions) {
    const satisfait = await isEtapeConditionSatisfied(condition, dossierId, dossier, statutParEtapeId);
    if (!satisfait) reasons.push({ source: "CONDITION", conditionId: condition.id, libelle: condition.libelle });
  }
  return reasons;
}

/**
 * Toutes les raisons de blocage d'UNE étape pour UN dossier - documents
 * (réutilise getBlockingReasonsForEtape existant tel quel, jamais dupliqué)
 * PLUS les EtapeCondition obligatoires/bloquantes non satisfaites (via
 * getExternalConditionReasons ci-dessus). Fonction centrale : terminerEtape()
 * (src/app/dossiers/workflow-actions.ts) et isReadyForProduction()
 * ci-dessous l'utilisent tous les deux - une seule source de vérité pour
 * "qu'est-ce qui bloque cette étape".
 */
export async function getGateBlockingReasons(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<GateBlockingReason[]> {
  const [docBlocages, conditionReasons] = await Promise.all([
    getBlockingReasonsForEtape(dossierId, etapeProgrammeId, organisationId),
    getExternalConditionReasons(dossierId, etapeProgrammeId, organisationId),
  ]);

  return [...docBlocages.map((b) => ({ source: "DOCUMENT" as const, libelle: b.typeDocumentNom })), ...conditionReasons];
}

/**
 * Vrai si l'étape peut devenir DISPONIBLE : aucune EtapeCondition
 * obligatoire/bloquante (hors documents, cf. commentaire de
 * getExternalConditionReasons) en attente. Utilisée par
 * recalculateDossierWorkflow() en complément d'EtapeDependance.
 */
export async function isEtapeAccessible(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<boolean> {
  const reasons = await getExternalConditionReasons(dossierId, etapeProgrammeId, organisationId);
  return reasons.length === 0;
}

export async function isEtapeComplete(dossierEtapeId: string): Promise<boolean> {
  const de = await prisma.dossierEtape.findUnique({ where: { id: dossierEtapeId }, select: { statut: true } });
  return de?.statut === "TERMINE";
}

/**
 * Vrai si toutes les étapes actives OBLIGATOIRES de la ProgrammeVersion du
 * dossier n'ont plus aucun blocage (documentaire ou condition externe) - la
 * définition générique de "prêt à produire" (audit SaaS section D/18) :
 * dérivée des données (Programme/EtapeProgramme/EtapeCondition), jamais un
 * `if (programme === "MaPrimeRénov") { ... }` codé en dur dans une page.
 * Un dossier sans programme affecté est considéré prêt par défaut (rien à
 * bloquer).
 */
export async function isReadyForProduction(dossierId: string, organisationId: string): Promise<{ ready: boolean; blockingReasons: GateBlockingReason[] }> {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { programmeVersionId: true } });
  if (!dossier?.programmeVersionId) return { ready: true, blockingReasons: [] };

  const etapes = await prisma.etapeProgramme.findMany({
    where: { programmeVersionId: dossier.programmeVersionId, actif: true, obligatoire: true },
    select: { id: true },
  });

  const allReasons: GateBlockingReason[] = [];
  for (const etape of etapes) {
    allReasons.push(...(await getGateBlockingReasons(dossierId, etape.id, organisationId)));
  }

  return { ready: allReasons.length === 0, blockingReasons: allReasons };
}

// Alias explicite demandé par l'audit SaaS (section D) - même fonction que
// getGateBlockingReasons, exposée sous ce nom pour matcher exactement
// isEtapeAccessible/isEtapeComplete/getBlockingConditions/isReadyForProduction.
export const getBlockingConditions = getGateBlockingReasons;
