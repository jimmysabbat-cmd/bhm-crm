import { getDocumentChecklistForDossier } from "./checklist";

// ============================================================
// Blocages documentaires (P10, section 11) - une exigence bloquante non
// satisfaite empêche transmission/passage d'étape (section 12), mais
// SEULEMENT quand explicitement configurée (blocking=true) - jamais un
// blocage par défaut.
// ============================================================

export type DocumentBlockingReason = {
  requirementId: string;
  typeDocumentNom: string;
  status: string;
  sourceLabel: string;
};

export async function getDocumentBlockingReasons(dossierId: string, organisationId: string): Promise<DocumentBlockingReason[]> {
  const checklist = await getDocumentChecklistForDossier(dossierId, organisationId);
  return checklist.requirements
    .filter((r) => r.blocking && r.status !== "VALIDE")
    .map((r) => ({
      requirementId: r.requirementId,
      typeDocumentNom: r.typeDocumentNom,
      status: r.status,
      sourceLabel: r.sourceRequirement.label,
    }));
}

/**
 * Sous-ensemble des blocages documentaires rattachés à UNE étape précise
 * (section 12) - utilisé par terminerEtape() pour n'empêcher la fin d'une
 * étape que si CETTE étape a explicitement une exigence bloquante non
 * satisfaite, jamais toutes les étapes par défaut.
 */
export async function getBlockingReasonsForEtape(dossierId: string, etapeProgrammeId: string, organisationId: string): Promise<DocumentBlockingReason[]> {
  const checklist = await getDocumentChecklistForDossier(dossierId, organisationId);
  return checklist.requirements
    .filter((r) => r.blocking && r.status !== "VALIDE" && r.etapeProgrammeId === etapeProgrammeId)
    .map((r) => ({ requirementId: r.requirementId, typeDocumentNom: r.typeDocumentNom, status: r.status, sourceLabel: r.sourceRequirement.label }));
}
