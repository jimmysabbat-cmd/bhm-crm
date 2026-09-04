import type { DocumentStorageProvider } from "./types";
import { LocalDocumentStorageProvider } from "./local-provider";
import { S3ObjectStorageProvider, s3ConfigFromEnv } from "./s3-provider";

// ============================================================
// Sélection du provider de stockage documentaire (P12, section 7/8) -
// STORAGE_PROVIDER=local (défaut) | s3. Aucun secret en dur : la
// configuration S3 vient exclusivement de variables d'environnement
// (STORAGE_ENDPOINT/STORAGE_BUCKET/STORAGE_ACCESS_KEY_ID/
// STORAGE_SECRET_ACCESS_KEY/STORAGE_REGION).
// ============================================================

let cached: DocumentStorageProvider | null = null;

export function getDocumentStorageProvider(): DocumentStorageProvider {
  if (cached) return cached;

  const kind = process.env.STORAGE_PROVIDER ?? "local";
  if (kind === "s3") {
    const config = s3ConfigFromEnv();
    if (!config) {
      throw new Error("STORAGE_PROVIDER=s3 mais la configuration est incomplète (STORAGE_ENDPOINT/STORAGE_BUCKET/STORAGE_ACCESS_KEY_ID/STORAGE_SECRET_ACCESS_KEY).");
    }
    cached = new S3ObjectStorageProvider(config);
  } else {
    cached = new LocalDocumentStorageProvider();
  }
  return cached;
}

export type { DocumentStorageProvider, StoredFile } from "./types";
