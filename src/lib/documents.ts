import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Stockés hors de /public pour ne pas être servis directement sans
// authentification - toujours passer par /api/documents/[docId].
const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "dossiers");

function assertInsideUploadRoot(target: string): void {
  const resolved = path.resolve(target);
  if (resolved !== UPLOAD_ROOT && !resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error("Chemin de fichier invalide.");
  }
}

export async function saveDocumentFile(dossierId: string, file: File) {
  const dir = path.join(UPLOAD_ROOT, dossierId);
  assertInsideUploadRoot(dir);
  await mkdir(dir, { recursive: true });

  const ext = path.extname(file.name);
  const storedName = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buffer);

  return {
    cheminFichier: path.join(dossierId, storedName),
    nomFichier: file.name,
    mimeType: file.type || "application/octet-stream",
    tailleOctets: buffer.length,
  };
}

export function documentFilePath(cheminFichier: string): string {
  const full = path.join(UPLOAD_ROOT, cheminFichier);
  assertInsideUploadRoot(full);
  return full;
}

export async function deleteDocumentFile(cheminFichier: string): Promise<void> {
  await unlink(documentFilePath(cheminFichier)).catch(() => {});
}
