import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents";
import { requireUserContext, hasPermission } from "@/lib/authz";

// ============================================================
// P16 - téléchargement du PDF d'une facture (DONNEUR_ORDRE générée par nos
// soins ou SOUS_TRAITANT déposée). Trois populations autorisées, chacune
// STRICTEMENT scopée à SES PROPRES factures (jamais une comparaison de
// nom, toujours une comparaison de clé étrangère - même discipline que
// /api/documents/[docId]) :
//   - interne (même organisation, permission VIEW_FINANCIAL_SUMMARY)
//   - le donneur d'ordre destinataire de CETTE facture
//   - le sous-traitant émetteur de CETTE facture
// ============================================================

export async function GET(_request: Request, { params }: { params: Promise<{ factureId: string }> }) {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const { factureId } = await params;
  const facture = await prisma.facture.findFirst({
    where: { id: factureId, organisationId: ctx.organisationId },
    select: { id: true, numero: true, fichierPdfPath: true, donneurOrdreId: true, sousTraitantId: true },
  });
  if (!facture) return new NextResponse("Introuvable", { status: 404 });

  const estInterne = ctx.role !== "DONNEUR_ORDRE" && ctx.role !== "SOUS_TRAITANT" && hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY");
  const estLeDonneurOrdre = ctx.role === "DONNEUR_ORDRE" && ctx.donneurOrdreId != null && ctx.donneurOrdreId === facture.donneurOrdreId;
  const estLeSousTraitant = ctx.role === "SOUS_TRAITANT" && ctx.sousTraitantId != null && ctx.sousTraitantId === facture.sousTraitantId;

  if (!estInterne && !estLeDonneurOrdre && !estLeSousTraitant) {
    return new NextResponse("Accès refusé", { status: 403 });
  }
  if (!facture.fichierPdfPath) {
    return new NextResponse("Aucun fichier pour cette facture", { status: 404 });
  }

  const buffer = await readDocumentFile(facture.fichierPdfPath).catch(() => null);
  if (!buffer) return new NextResponse("Fichier introuvable", { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(facture.numero)}.pdf"`,
    },
  });
}
