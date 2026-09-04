import { prisma } from "@/lib/prisma";
import { getDocumentChecklistForDossier } from "./checklist";
import { isSensitiveTypeDocumentCode } from "./sensitive";
import type { DestinationTransmission } from "@/generated/prisma/enums";

// ============================================================
// Transmissibilité + profils de package (P10, sections 15-18) - un
// destinataire ne doit JAMAIS recevoir plus que ce qui lui est nécessaire
// (section 17). Les profils filtrent par destination ET excluent les
// pièces sensibles pour les destinataires externes (CEE/délégataire/
// sous-traitant/contrôleur/fournisseur) même si, par erreur de
// paramétrage, une exigence sensible leur était associée.
// ============================================================

export type TransmissionReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

export type TransmissionReadiness = {
  status: TransmissionReadinessStatus;
  missingDocuments: string[];
  invalidDocuments: string[];
  expiredDocuments: string[];
  warnings: string[];
  reasons: string[];
};

export async function evaluateTransmissionReadiness(params: {
  dossierId: string;
  organisationId: string;
  destination: DestinationTransmission;
}): Promise<TransmissionReadiness> {
  const checklist = await getDocumentChecklistForDossier(params.dossierId, params.organisationId);
  const relevant = checklist.requirements.filter((r) => r.destination === params.destination);

  const missingDocuments = relevant.filter((r) => r.status === "MANQUANT").map((r) => r.typeDocumentNom);
  const invalidDocuments = relevant.filter((r) => r.status === "REFUSE").map((r) => r.typeDocumentNom);
  const expiredDocuments = relevant.filter((r) => r.status === "EXPIRE").map((r) => r.typeDocumentNom);
  const toVerify = relevant.filter((r) => r.status === "A_VERIFIER");

  const blockingUnresolved = relevant.filter((r) => r.blocking && r.status !== "VALIDE");
  const requiredUnresolved = relevant.filter((r) => r.required && r.status !== "VALIDE");

  const reasons: string[] = [];
  const warnings: string[] = [];
  if (relevant.length === 0) reasons.push(`Aucune exigence documentaire configurée pour la destination ${params.destination} - vérifier le référentiel avant transmission.`);

  let status: TransmissionReadinessStatus;
  if (blockingUnresolved.length > 0) {
    status = "BLOCKED";
    reasons.push(...blockingUnresolved.map((r) => `${r.typeDocumentNom} bloquant (${r.status})`));
  } else if (requiredUnresolved.length > 0) {
    status = "READY_WITH_WARNINGS";
    warnings.push(...requiredUnresolved.map((r) => `${r.typeDocumentNom} obligatoire non validé (${r.status})`));
  } else {
    status = "READY";
  }
  if (toVerify.length > 0) warnings.push(`${toVerify.length} pièce(s) encore à vérifier avant transmission.`);

  return { status, missingDocuments, invalidDocuments, expiredDocuments, warnings, reasons };
}

export const PACKAGE_PROFILE_LABELS: Record<DestinationTransmission, string> = {
  ANAH: "ANAH",
  MAR: "MAR",
  CEE: "CEE",
  DELEGATAIRE_CEE: "Délégataire CEE",
  CONTROLEUR: "Contrôleur",
  SOUS_TRAITANT: "Sous-traitant",
  FOURNISSEUR: "Fournisseur",
  CLIENT: "Client",
  COMPTABILITE: "Comptabilité",
  AUTRE: "Autre",
};

// Destinations externes à l'entreprise - jamais de pièce sensible
// (identité/fiscal), quelle que soit la configuration des exigences.
const EXTERNAL_DESTINATIONS = new Set<DestinationTransmission>(["CEE", "DELEGATAIRE_CEE", "CONTROLEUR", "SOUS_TRAITANT", "FOURNISSEUR", "AUTRE"]);

export type PackagePreviewIncludedDoc = {
  dossierDocumentId: string;
  requirementId: string;
  typeDocumentId: string;
  typeDocumentCode: string;
  typeDocumentNom: string;
  nomFichier: string;
  version: number;
};

export type PackagePreviewExcludedDoc = {
  dossierDocumentId: string;
  typeDocumentNom: string;
  reason: string;
};

export type TransmissionPackagePreview = {
  destination: DestinationTransmission;
  included: PackagePreviewIncludedDoc[];
  excluded: PackagePreviewExcludedDoc[];
  missingDocuments: string[];
  warnings: string[];
};

export async function buildTransmissionPackagePreview(params: {
  dossierId: string;
  organisationId: string;
  destination: DestinationTransmission;
}): Promise<TransmissionPackagePreview> {
  const checklist = await getDocumentChecklistForDossier(params.dossierId, params.organisationId);
  const relevant = checklist.requirements.filter((r) => r.destination === params.destination);
  const excludeSensitive = EXTERNAL_DESTINATIONS.has(params.destination);

  const included: PackagePreviewIncludedDoc[] = [];
  const excluded: PackagePreviewExcludedDoc[] = [];
  const missingDocuments: string[] = [];
  const warnings: string[] = [];

  for (const r of relevant) {
    const actifs = r.providedDocuments.filter((d) => d.statut !== "REMPLACE");
    if (actifs.length === 0) {
      if (r.required) missingDocuments.push(r.typeDocumentNom);
      continue;
    }
    for (const d of actifs) {
      if (d.statut !== "VALIDE") {
        excluded.push({ dossierDocumentId: d.id, typeDocumentNom: r.typeDocumentNom, reason: `Statut ${d.statut} - non validé, jamais inclus dans un package.` });
        continue;
      }
      if (excludeSensitive && isSensitiveTypeDocumentCode(r.typeDocumentCode)) {
        excluded.push({ dossierDocumentId: d.id, typeDocumentNom: r.typeDocumentNom, reason: `Pièce sensible exclue du profil ${PACKAGE_PROFILE_LABELS[params.destination]}.` });
        continue;
      }
      included.push({
        dossierDocumentId: d.id,
        requirementId: r.requirementId,
        typeDocumentId: r.typeDocumentId,
        typeDocumentCode: r.typeDocumentCode,
        typeDocumentNom: r.typeDocumentNom,
        nomFichier: d.nomFichier,
        version: d.version,
      });
    }
  }

  if (included.length === 0) warnings.push("Aucun document validé ne correspond à ce profil de transmission pour l'instant.");

  return { destination: params.destination, included, excluded, missingDocuments, warnings };
}

/**
 * Crée le package (section 16/18) - snapshot figé de la preview au moment T
 * (section 29) : un remplacement ultérieur d'un document ne modifie jamais
 * ce package historique, seul isTransmissionPackageStale() le signale.
 */
export async function createTransmissionPackage(params: {
  dossierId: string;
  organisationId: string;
  destination: DestinationTransmission;
  destinationName: string | null;
  comment: string | null;
  createdById: string;
}): Promise<string> {
  const preview = await buildTransmissionPackagePreview(params);

  const pkg = await prisma.transmissionPackage.create({
    data: {
      organisationId: params.organisationId,
      dossierId: params.dossierId,
      destinationType: params.destination,
      destinationName: params.destinationName,
      status: "BROUILLON",
      snapshot: JSON.parse(JSON.stringify(preview)),
      comment: params.comment,
      createdById: params.createdById,
      documents: {
        create: preview.included.map((d, i) => ({
          dossierDocumentId: d.dossierDocumentId,
          typeDocumentId: d.typeDocumentId,
          version: d.version,
          ordre: i,
        })),
      },
    },
  });

  return pkg.id;
}

/**
 * Un package devient obsolète (section 32) si un document qu'il contient a
 * été remplacé depuis - jamais le package lui-même n'est modifié, seul un
 * indicateur est calculé à la lecture.
 */
export async function isTransmissionPackageStale(packageId: string, organisationId: string): Promise<boolean> {
  const pkg = await prisma.transmissionPackage.findFirst({
    where: { id: packageId, organisationId },
    include: { documents: { include: { dossierDocument: { select: { statut: true, version: true } } } } },
  });
  if (!pkg) throw new Error("Package introuvable.");
  return pkg.documents.some((d) => d.dossierDocument.statut === "REMPLACE" || d.dossierDocument.version !== d.version);
}
