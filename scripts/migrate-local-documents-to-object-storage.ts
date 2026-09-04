import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { LocalDocumentStorageProvider } from "../src/lib/storage/local-provider";
import { s3ConfigFromEnv, S3ObjectStorageProvider } from "../src/lib/storage/s3-provider";

// ============================================================
// migrate-local-documents-to-object-storage (P12, section 10) - dry-run
// PAR DÉFAUT, checksum, comptage, détection d'erreurs, AUCUNE suppression
// de la source par défaut (--delete-source explicite requis, jamais
// recommandé avant plusieurs vérifications manuelles). Ne pas exécuter
// contre un vrai bucket sans autorisation explicite de Jimmy.
//
// Usage :
//   npx tsx scripts/migrate-local-documents-to-object-storage.ts            (dry-run)
//   npx tsx scripts/migrate-local-documents-to-object-storage.ts --execute  (upload réel, nécessite STORAGE_* configurés)
// ============================================================

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const execute = process.argv.includes("--execute");
  const deleteSource = process.argv.includes("--delete-source");
  if (deleteSource && !execute) {
    console.error("--delete-source n'a de sens qu'avec --execute.");
    process.exitCode = 1;
    return;
  }

  const local = new LocalDocumentStorageProvider();
  let remote: S3ObjectStorageProvider | null = null;
  if (execute) {
    const config = s3ConfigFromEnv();
    if (!config) {
      console.error("Configuration STORAGE_* incomplète - impossible d'exécuter en mode réel (le dry-run reste possible sans configuration).");
      process.exitCode = 1;
      return;
    }
    remote = new S3ObjectStorageProvider(config);
  }

  const documents = await prisma.dossierDocument.findMany({ select: { id: true, cheminFichier: true, nomFichier: true, dossierId: true } });
  console.log(`${documents.length} document(s) à traiter. Mode : ${execute ? "EXECUTE (upload réel)" : "DRY RUN (aucun effet)"}${deleteSource ? " + suppression source" : ""}`);

  let ok = 0;
  let errors = 0;
  let totalBytes = 0;

  for (const doc of documents) {
    try {
      const buffer = await local.read(doc.cheminFichier);
      const checksum = sha256(buffer);
      totalBytes += buffer.length;

      if (!execute) {
        console.log(`  [DRY RUN] ${doc.id} · ${doc.cheminFichier} · ${buffer.length} octets · sha256=${checksum.slice(0, 12)}…`);
        ok++;
        continue;
      }

      // Upload réel : réutilise la MÊME clé (cheminFichier) pour que la
      // colonne DB reste valide sans migration de données supplémentaire -
      // seul le provider actif (STORAGE_PROVIDER=s3) change ensuite.
      await remote!.putRaw(doc.cheminFichier, buffer, "application/octet-stream");

      console.log(`  [OK] ${doc.id} · ${doc.cheminFichier} · ${buffer.length} octets · sha256=${checksum.slice(0, 12)}…`);
      ok++;

      if (deleteSource) {
        await local.delete(doc.cheminFichier);
      }
    } catch (e) {
      errors++;
      console.error(`  [ERREUR] ${doc.id} · ${doc.cheminFichier} : ${e instanceof Error ? e.message : "erreur inconnue"}`);
    }
  }

  console.log(`\nTotal : ${ok} OK, ${errors} erreur(s), ${(totalBytes / 1_048_576).toFixed(2)} Mo.`);
  process.exitCode = errors > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
