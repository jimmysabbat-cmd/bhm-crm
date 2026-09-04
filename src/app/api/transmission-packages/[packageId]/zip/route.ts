import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents";
import { requireUserContext, hasPermission, canAccessPackageAsPartner } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { buildZip, cleanExportFileName } from "@/lib/documents/zip";

// Export ZIP d'un package de transmission (P10, section 19 ; P11, section
// 23/24) - noms de fichiers propres appliqués UNIQUEMENT dans le ZIP (le
// fichier stocké sur disque n'est jamais renommé, section 20). Réutilise
// documentFilePath() (protections de chemin P0) pour chaque pièce incluse.
// Accessible soit à un interne avec DOWNLOAD_TRANSMISSION_PACKAGE, soit à
// un partenaire (sous-traitant/délégataire CEE) UNIQUEMENT si ce package
// lui est explicitement destiné.
export async function GET(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
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

  const isInternal = hasPermission(ctx, "DOWNLOAD_TRANSMISSION_PACKAGE");
  const isPartner = canAccessPackageAsPartner(ctx, pkg);
  if (!isInternal && !isPartner) {
    return new NextResponse("Accès refusé", { status: 403 });
  }
  // Un package non encore transmis (BROUILLON) reste un usage interne
  // uniquement - un partenaire ne télécharge que ce qui a été explicitement
  // marqué PRÊT ou TRANSMIS, jamais un brouillon en cours de préparation.
  if (isPartner && !isInternal && pkg.status === "BROUILLON") {
    return new NextResponse("Package pas encore prêt.", { status: 403 });
  }

  const entries = [];
  for (let i = 0; i < pkg.documents.length; i++) {
    const d = pkg.documents[i];
    const buffer = await readDocumentFile(d.dossierDocument.cheminFichier).catch(() => null);
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
