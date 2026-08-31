import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { documentFilePath } from "@/lib/documents";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const { docId } = await params;
  const doc = await prisma.dossierDocument.findUnique({ where: { id: docId } });
  if (!doc) {
    return new NextResponse("Introuvable", { status: 404 });
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
