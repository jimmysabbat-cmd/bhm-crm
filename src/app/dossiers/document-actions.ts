"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { saveDocumentFile, deleteDocumentFile } from "@/lib/documents";
import { computeExpirationDate } from "@/lib/documents/expiration";
import { getMissingDocumentsRelanceData, type RelanceDocumentaireData } from "@/lib/documents/relance";
import type { PorteeDocument, SourceDonnee } from "@/generated/prisma/enums";

// ============================================================
// Cycle de vie documentaire (P10) : upload -> validation/refus ->
// remplacement. Un fichier uploadé n'est JAMAIS confondu avec un document
// validé (section 4) - statut initial toujours FOURNI, jamais VALIDE.
// Le remplacement ne supprime jamais l'ancien document (section 6) : il
// passe au statut REMPLACE et reste consultable via `replaces`.
// ============================================================

// Correspondance best-effort vers l'ancien enum TypeDocument (préservé
// intact - section 1) pour que documentsRequisStatus() (workflow existant)
// continue de fonctionner sans modification pour les codes qui s'y prêtent.
const LEGACY_TYPE_MAP: Record<string, "DEVIS" | "AUDIT" | "PHOTO_VISITE" | "PHOTO_CHANTIER" | "AUTRE"> = {
  DEVIS_SIGNE: "DEVIS",
  AUDIT_ENERGETIQUE: "AUDIT",
  PHOTOS_AVANT: "PHOTO_VISITE",
  PHOTOS_APRES: "PHOTO_CHANTIER",
};

async function loadOwnedDossier(dossierId: string, organisationId: string) {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");
  return dossier;
}

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

export async function uploadDossierDocument(formData: FormData): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "UPLOAD_DOCUMENTS")) throw new Error("Accès refusé.");

    const dossierId = String(formData.get("dossierId"));
    const dossier = await loadOwnedDossier(dossierId, ctx.organisationId);
    const file = formData.get("file") as File;
    if (!file || file.size === 0) throw new Error("Fichier requis.");

    const requirementId = str(formData, "requirementId");
    const requirement = requirementId
      ? await prisma.documentRequirement.findFirst({ where: { id: requirementId }, include: { typeDocument: true } })
      : null;
    const typeDocumentId = requirement?.typeDocumentId ?? str(formData, "typeDocumentId");
    if (!typeDocumentId) throw new Error("Type de document requis.");
    const typeDocument = requirement?.typeDocument ?? (await prisma.typeDocumentReferentiel.findUniqueOrThrow({ where: { id: typeDocumentId } }));

    const saved = await saveDocumentFile(dossier.id, file);
    const dateExpiration = requirement?.validiteJours != null ? computeExpirationDate(requirement.validiteJours, new Date()) : null;

    const doc = await prisma.dossierDocument.create({
      data: {
        dossierId,
        type: LEGACY_TYPE_MAP[typeDocument.code] ?? "AUTRE",
        ...saved,
        organisationId: ctx.organisationId,
        typeDocumentId: typeDocument.id,
        requirementId: requirement?.id ?? null,
        portee: (str(formData, "portee") as PorteeDocument | null) ?? requirement?.portee ?? "DOSSIER",
        clientId: str(formData, "clientId"),
        posteTravauxId: str(formData, "posteTravauxId"),
        statut: "FOURNI",
        dateExpiration,
        provenance: (str(formData, "provenance") as SourceDonnee | null) ?? "COMMERCIAL",
        createdById: ctx.userId,
      },
    });

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: doc.id, action: "DOCUMENT_UPLOAD", metadata: { dossierId, typeDocument: typeDocument.code } });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true, docId: doc.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function loadOwnedDocument(docId: string, organisationId: string) {
  const doc = await prisma.dossierDocument.findFirst({ where: { id: docId, dossier: { organisationId } } });
  if (!doc) throw new Error("Document introuvable.");
  return doc;
}

export async function validateDossierDocument(docId: string, comment?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VALIDATE_DOCUMENTS")) throw new Error("Accès refusé.");
    const doc = await loadOwnedDocument(docId, ctx.organisationId);

    await prisma.dossierDocument.update({
      where: { id: doc.id },
      data: { statut: "VALIDE", validatedById: ctx.userId, validatedAt: new Date(), validationComment: comment ?? null, rejectionReason: null },
    });

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: doc.id, action: "DOCUMENT_VALIDE", metadata: { dossierId: doc.dossierId } });

    revalidatePath(`/dossiers/${doc.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function refuseDossierDocument(docId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VALIDATE_DOCUMENTS")) throw new Error("Accès refusé.");
    if (!reason || reason.trim() === "") throw new Error("Un motif de refus est obligatoire.");
    const doc = await loadOwnedDocument(docId, ctx.organisationId);

    await prisma.dossierDocument.update({
      where: { id: doc.id },
      data: { statut: "REFUSE", validatedById: ctx.userId, validatedAt: new Date(), rejectionReason: reason.trim(), validationComment: null },
    });

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: doc.id, action: "DOCUMENT_REFUSE", metadata: { dossierId: doc.dossierId, motif: reason.trim() } });

    revalidatePath(`/dossiers/${doc.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * Remplace un document (section 6) - l'ancien devient REMPLACE, JAMAIS
 * supprimé. Le nouveau reprend le même requirement/type/portée et incrémente
 * la version.
 */
export async function replaceDossierDocument(oldDocId: string, formData: FormData): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "UPLOAD_DOCUMENTS")) throw new Error("Accès refusé.");
    const old = await loadOwnedDocument(oldDocId, ctx.organisationId);

    const file = formData.get("file") as File;
    if (!file || file.size === 0) throw new Error("Fichier requis.");

    const requirement = old.requirementId ? await prisma.documentRequirement.findUnique({ where: { id: old.requirementId } }) : null;
    const saved = await saveDocumentFile(old.dossierId, file);
    const dateExpiration = requirement?.validiteJours != null ? computeExpirationDate(requirement.validiteJours, new Date()) : null;

    const nouveau = await prisma.dossierDocument.create({
      data: {
        dossierId: old.dossierId,
        type: old.type,
        ...saved,
        organisationId: ctx.organisationId,
        typeDocumentId: old.typeDocumentId,
        requirementId: old.requirementId,
        portee: old.portee,
        clientId: old.clientId,
        posteTravauxId: old.posteTravauxId,
        statut: "FOURNI",
        dateExpiration,
        provenance: old.provenance,
        replacesId: old.id,
        version: old.version + 1,
        createdById: ctx.userId,
      },
    });

    await prisma.dossierDocument.update({ where: { id: old.id }, data: { statut: "REMPLACE" } });

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: nouveau.id, action: "DOCUMENT_REMPLACE", metadata: { dossierId: old.dossierId, ancienDocumentId: old.id } });

    revalidatePath(`/dossiers/${old.dossierId}`);
    return { ok: true, docId: nouveau.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function deleteDossierDocumentV2(docId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VALIDATE_DOCUMENTS")) throw new Error("Accès refusé.");
    const doc = await loadOwnedDocument(docId, ctx.organisationId);
    if (doc.statut === "VALIDE") throw new Error("Un document validé ne peut pas être supprimé - le refuser ou le remplacer.");

    await deleteDocumentFile(doc.cheminFichier);
    await prisma.dossierDocument.delete({ where: { id: docId } });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: docId, action: "DOCUMENT_SUPPRIME", metadata: { dossierId: doc.dossierId } });

    revalidatePath(`/dossiers/${doc.dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/**
 * "Relancer pour pièces manquantes" (section 22/23) - action REGROUPÉE :
 * une seule relance journalisée pour tout le dossier, jamais une par pièce.
 * P10 ne fait aucun envoi mail/SMS automatique ; ceci prépare seulement la
 * donnée structurée et la trace d'audit qu'un futur envoi pourra réutiliser.
 */
export async function getDocumentRelanceData(dossierId: string): Promise<{ ok: true; data: RelanceDocumentaireData } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "VIEW_DOCUMENTS")) throw new Error("Accès refusé.");
    const data = await getMissingDocumentsRelanceData(dossierId, ctx.organisationId);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function enregistrerRelanceDocuments(dossierId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "UPLOAD_DOCUMENTS")) throw new Error("Accès refusé.");
    const data = await getMissingDocumentsRelanceData(dossierId, ctx.organisationId);
    if (data.documentsManquants.length === 0) throw new Error("Aucune pièce manquante côté client pour ce dossier.");

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Dossier",
      entityId: dossierId,
      action: "RELANCE_DOCUMENTS_DEMANDEE",
      metadata: { nbPieces: data.documentsManquants.length, pieces: data.documentsManquants.map((d) => d.typeDocumentNom).join(", ") },
    });

    revalidatePath(`/dossiers/${dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
