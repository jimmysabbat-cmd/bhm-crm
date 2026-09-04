import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { DocumentStorageProvider, StoredFile } from "./types";

// ============================================================
// LocalDocumentStorageProvider - wrapper direct de l'implémentation
// filesystem historique (src/lib/documents.ts), comportement STRICTEMENT
// identique. Ne fonctionne que sur un hébergement à disque persistant -
// BLOCKER sur serverless/éphémère (cf. rapport P12).
// ============================================================

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "dossiers");

function assertInsideUploadRoot(target: string): void {
  const resolved = path.resolve(target);
  if (resolved !== UPLOAD_ROOT && !resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error("Chemin de fichier invalide.");
  }
}

export class LocalDocumentStorageProvider implements DocumentStorageProvider {
  readonly name = "local";

  async save(dossierId: string, file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<StoredFile> {
    const dir = path.join(UPLOAD_ROOT, dossierId);
    assertInsideUploadRoot(dir);
    await mkdir(dir, { recursive: true });

    const ext = path.extname(file.name);
    const storedName = `${crypto.randomUUID()}${ext}`;
    const fullPath = path.join(dir, storedName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    return {
      key: path.join(dossierId, storedName),
      nomFichier: file.name,
      mimeType: file.type || "application/octet-stream",
      tailleOctets: buffer.length,
    };
  }

  async read(key: string): Promise<Buffer> {
    const full = path.join(UPLOAD_ROOT, key);
    assertInsideUploadRoot(full);
    return readFile(full);
  }

  async delete(key: string): Promise<void> {
    const full = path.join(UPLOAD_ROOT, key);
    assertInsideUploadRoot(full);
    await unlink(full).catch(() => {});
  }

  // Pas d'URL signée pour le stockage local en V1 - le téléchargement
  // passe par le backend (read() + réponse HTTP), déjà protégé par
  // authentification/organisation (routes /api/documents, /api/
  // transmission-packages).
  async getSignedUrl(): Promise<string | null> {
    return null;
  }
}
