import { prisma } from "@/lib/prisma";
import { getDocumentChecklistForDossier } from "./checklist";

// ============================================================
// Dashboard administratif documentaire (P10, section 26) - comptages
// simples depuis les données réelles, même esprit que le dashboard
// commercial P9 (pas d'analytics complexe).
// ============================================================

export type DocumentAdminDashboard = {
  dossiersBloquesParPieces: number;
  piecesAVerifier: number;
  piecesRefusees: number;
  piecesExpirees: number;
  packagesPrets: number;
  packagesBrouillon: number;
};

export async function getDocumentAdminDashboard(organisationId: string): Promise<DocumentAdminDashboard> {
  const dossiers = await prisma.dossier.findMany({ where: { organisationId, statut: { key: { not: "CLOTURE" } } }, select: { id: true } });

  let dossiersBloquesParPieces = 0;
  let piecesAVerifier = 0;
  let piecesRefusees = 0;
  let piecesExpirees = 0;

  for (const d of dossiers) {
    const checklist = await getDocumentChecklistForDossier(d.id, organisationId);
    if (checklist.blockingCount > 0) dossiersBloquesParPieces++;
    piecesAVerifier += checklist.requirements.filter((r) => r.status === "A_VERIFIER").length;
    piecesRefusees += checklist.requirements.filter((r) => r.status === "REFUSE").length;
    piecesExpirees += checklist.requirements.filter((r) => r.status === "EXPIRE").length;
  }

  const [packagesPrets, packagesBrouillon] = await Promise.all([
    prisma.transmissionPackage.count({ where: { organisationId, status: "PRET" } }),
    prisma.transmissionPackage.count({ where: { organisationId, status: "BROUILLON" } }),
  ]);

  return { dossiersBloquesParPieces, piecesAVerifier, piecesRefusees, piecesExpirees, packagesPrets, packagesBrouillon };
}
