import { prisma } from "@/lib/prisma";
import { isDocumentExpired } from "./expiration";
import type {
  ResponsableDocument,
  DestinationTransmission,
  PorteeDocument,
  StatutDocument,
} from "@/generated/prisma/enums";

// ============================================================
// Checklist documentaire (P10, section 3) - FONCTION CENTRALE UNIQUE
// réutilisée par l'UI, le NBA et la transmission. Agrège les exigences
// applicables depuis le programme/workflow, la réglementation P7, le poste
// de travaux et les règles internes - jamais une seconde logique
// d'agrégation ailleurs.
// ============================================================

export type ChecklistItemStatus = "MANQUANT" | "FOURNI" | "A_VERIFIER" | "VALIDE" | "REFUSE" | "EXPIRE";

export type ChecklistDocumentSummary = {
  id: string;
  nomFichier: string;
  statut: StatutDocument;
  dateExpiration: Date | null;
  expired: boolean;
  version: number;
  createdAt: Date;
};

export type ChecklistRequirementItem = {
  requirementId: string;
  typeDocumentId: string;
  typeDocumentCode: string;
  typeDocumentNom: string;
  required: boolean;
  etapeProgrammeId: string | null;
  sourceRequirement: { kind: "ETAPE" | "REGLEMENTAIRE" | "TYPE_TRAVAUX" | "INTERNE"; label: string };
  status: ChecklistItemStatus;
  providedDocuments: ChecklistDocumentSummary[];
  missing: boolean;
  invalid: boolean;
  expired: boolean;
  toVerify: boolean;
  responsible: ResponsableDocument | null;
  destination: DestinationTransmission | null;
  portee: PorteeDocument;
  blocking: boolean;
  minCount: number;
  maxCount: number | null;
  multipleAutorise: boolean;
};

export type DocumentChecklist = {
  requirements: ChecklistRequirementItem[];
  completionPct: number;
  blockingCount: number;
};

function computeItemStatus(actifs: { statut: StatutDocument; dateExpiration: Date | null }[], minCount: number): {
  status: ChecklistItemStatus;
  missing: boolean;
  invalid: boolean;
  expired: boolean;
  toVerify: boolean;
} {
  const valides = actifs.filter((d) => d.statut === "VALIDE" && !isDocumentExpired(d));
  const expires = actifs.filter((d) => d.statut === "VALIDE" && isDocumentExpired(d));
  const refuses = actifs.filter((d) => d.statut === "REFUSE");
  const aVerifier = actifs.filter((d) => d.statut === "FOURNI" || d.statut === "A_VERIFIER");

  const satisfied = valides.length >= minCount;
  const invalid = refuses.length > 0;
  const expired = expires.length > 0;
  const toVerify = aVerifier.length > 0;
  const missing = actifs.length === 0;

  let status: ChecklistItemStatus;
  if (satisfied) status = "VALIDE";
  else if (toVerify) status = "A_VERIFIER";
  else if (expired) status = "EXPIRE";
  else if (invalid) status = "REFUSE";
  else status = "MANQUANT";

  return { status, missing, invalid, expired, toVerify };
}

export async function getDocumentChecklistForDossier(dossierId: string, organisationId: string): Promise<DocumentChecklist> {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    select: {
      id: true,
      programmeVersionId: true,
      postesTravaux: { select: { type: true, calculReglementaireActif: { select: { ruleVersionId: true } } } },
    },
  });
  if (!dossier) throw new Error("Dossier introuvable.");

  const etapeIds = dossier.programmeVersionId
    ? (await prisma.etapeProgramme.findMany({ where: { programmeVersionId: dossier.programmeVersionId }, select: { id: true } })).map((e) => e.id)
    : [];
  const regleVersionIds = Array.from(new Set(dossier.postesTravaux.map((p) => p.calculReglementaireActif?.ruleVersionId).filter((v): v is string => v != null)));
  const posteTypes = Array.from(new Set(dossier.postesTravaux.map((p) => p.type)));

  const orConditions: object[] = [{ etapeProgrammeId: null, regleVersionId: null, typeTravaux: null }];
  if (etapeIds.length > 0) orConditions.push({ etapeProgrammeId: { in: etapeIds } });
  if (regleVersionIds.length > 0) orConditions.push({ regleVersionId: { in: regleVersionIds } });
  if (posteTypes.length > 0) orConditions.push({ typeTravaux: { in: posteTypes }, etapeProgrammeId: null, regleVersionId: null });

  const requirements = await prisma.documentRequirement.findMany({
    where: {
      actif: true,
      AND: [{ OR: [{ organisationId: null }, { organisationId }] }, { OR: orConditions }],
    },
    include: {
      typeDocument: true,
      etapeProgramme: { select: { nom: true } },
      regleVersion: { select: { numeroVersion: true, regle: { select: { code: true } } } },
    },
    orderBy: { ordre: "asc" },
  });

  const allDocuments = await prisma.dossierDocument.findMany({
    where: { dossierId, organisationId },
    select: { id: true, nomFichier: true, statut: true, dateExpiration: true, version: true, createdAt: true, requirementId: true, typeDocumentId: true },
    orderBy: { createdAt: "desc" },
  });

  const items: ChecklistRequirementItem[] = requirements.map((req) => {
    const docs = allDocuments.filter((d) => (d.requirementId ? d.requirementId === req.id : d.typeDocumentId === req.typeDocumentId));
    const actifs = docs.filter((d) => d.statut !== "REMPLACE");
    const { status, missing, invalid, expired, toVerify } = computeItemStatus(actifs, req.minCount);

    const sourceRequirement: ChecklistRequirementItem["sourceRequirement"] = req.etapeProgramme
      ? { kind: "ETAPE", label: req.etapeProgramme.nom }
      : req.regleVersion
        ? { kind: "REGLEMENTAIRE", label: `${req.regleVersion.regle.code} v${req.regleVersion.numeroVersion}` }
        : req.typeTravaux
          ? { kind: "TYPE_TRAVAUX", label: req.typeTravaux }
          : { kind: "INTERNE", label: "Règle interne" };

    return {
      requirementId: req.id,
      typeDocumentId: req.typeDocumentId,
      typeDocumentCode: req.typeDocument.code,
      typeDocumentNom: req.typeDocument.nom,
      required: req.obligatoire,
      etapeProgrammeId: req.etapeProgrammeId,
      sourceRequirement,
      status,
      providedDocuments: docs.map((d) => ({
        id: d.id,
        nomFichier: d.nomFichier,
        statut: d.statut,
        dateExpiration: d.dateExpiration,
        expired: isDocumentExpired(d),
        version: d.version,
        createdAt: d.createdAt,
      })),
      missing,
      invalid,
      expired,
      toVerify,
      responsible: req.responsable,
      destination: req.destination,
      portee: req.portee,
      blocking: req.blocking,
      minCount: req.minCount,
      maxCount: req.maxCount,
      multipleAutorise: req.multipleAutorise,
    };
  });

  const obligatoires = items.filter((i) => i.required);
  const completionPct = obligatoires.length > 0 ? Math.round((obligatoires.filter((i) => i.status === "VALIDE").length / obligatoires.length) * 100) : 100;
  const blockingCount = items.filter((i) => i.blocking && i.status !== "VALIDE").length;

  return { requirements: items, completionPct, blockingCount };
}
