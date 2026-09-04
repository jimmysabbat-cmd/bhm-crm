import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { documentFilePath } from "@/lib/documents";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { isSensitiveTypeDocumentCode } from "@/lib/documents/sensitive";
import { logAudit } from "@/lib/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  // P10 (section 35) : un document ne doit JAMAIS être téléchargeable par un
  // utilisateur d'une AUTRE organisation, même authentifié - cette route ne
  // vérifiait auparavant que la présence d'une session, jamais l'appartenance
  // organisationnelle du document (faille corrigée ici).
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const { docId } = await params;
  const doc = await prisma.dossierDocument.findFirst({
    where: { id: docId, dossier: { organisationId: ctx.organisationId } },
    include: { typeDocumentRef: { select: { code: true } } },
  });
  if (!doc) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  if (!hasPermission(ctx, "VIEW_DOCUMENTS")) {
    return new NextResponse("Accès refusé", { status: 403 });
  }
  const sensible = isSensitiveTypeDocumentCode(doc.typeDocumentRef?.code ?? null);
  if (sensible && !hasPermission(ctx, "VIEW_SENSITIVE_DOCUMENTS")) {
    return new NextResponse("Accès refusé : pièce sensible.", { status: 403 });
  }
  if (sensible) {
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "DossierDocument", entityId: doc.id, action: "TELECHARGEMENT_PIECE_SENSIBLE", metadata: { nomFichier: doc.nomFichier } });
  }

  const buffer = await readFile(documentFilePath(doc.cheminFichier)).catch(() => null);
  if (!buffer) {
    return new NextResponse("Fichier introuvable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nomFichier)}"`,
    },
  });
}
