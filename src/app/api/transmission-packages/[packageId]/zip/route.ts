import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { documentFilePath } from "@/lib/documents";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { buildZip, cleanExportFileName } from "@/lib/documents/zip";

// Export ZIP d'un package de transmission (P10, section 19) - noms de
// fichiers propres appliqués UNIQUEMENT dans le ZIP (le fichier stocké sur
// disque n'est jamais renommé, section 20). Réutilise documentFilePath()
// (protections de chemin P0) pour chaque pièce incluse.
export async function GET(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }
  if (!hasPermission(ctx, "DOWNLOAD_TRANSMISSION_PACKAGE")) {
    return new NextResponse("Accès refusé", { status: 403 });
  }

  const { packageId } = await params;
  const pkg = await prisma.transmissionPackage.findFirst({
    where: { id: packageId, organisationId: ctx.organisationId },
    include: {
      dossier: { select: { reference: true } },
      documents: { orderBy: { ordre: "asc" }, include: { dossierDocument: { select: { cheminFichier: true, nomFichier: true } }, typeDocument: { select: { nom: true } } } },
    },
  });
  if (!pkg) return new NextResponse("Introuvable", { status: 404 });

  const entries = [];
  for (let i = 0; i < pkg.documents.length; i++) {
    const d = pkg.documents[i];
    const buffer = await readFile(documentFilePath(d.dossierDocument.cheminFichier)).catch(() => null);
    if (!buffer) continue;
    const name = cleanExportFileName(i + 1, d.typeDocument?.nom ?? "Document", d.dossierDocument.nomFichier);
    entries.push({ name, data: buffer });
  }

  const zip = buildZip(entries);

  await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "PACKAGE_TELECHARGE", metadata: { dossierId: pkg.dossierId, nbFichiers: entries.length } });

  const zipName = `${pkg.dossier.reference}-${pkg.destinationType}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
    },
  });
}
