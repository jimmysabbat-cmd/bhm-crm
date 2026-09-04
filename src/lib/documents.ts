import { getDocumentStorageProvider } from "./storage";

// ============================================================
// P12 (section 7) : ces fonctions ne touchent plus DIRECTEMENT le
// filesystem - elles délèguent au DocumentStorageProvider actif
// (local par défaut, S3-compatible via STORAGE_PROVIDER=s3). Signatures
// inchangées pour ne rien casser des appelants existants (P10/P11) ;
// `cheminFichier` reste le nom de colonne DB historique mais sa valeur est
// désormais une clé opaque de stockage, pas nécessairement un chemin
// filesystem réel (dépend du provider actif).
// ============================================================

export async function saveDocumentFile(dossierId: string, file: File) {
  const stored = await getDocumentStorageProvider().save(dossierId, file);
  return {
    cheminFichier: stored.key,
    nomFichier: stored.nomFichier,
    mimeType: stored.mimeType,
    tailleOctets: stored.tailleOctets,
  };
}

/** Lit le contenu d'un document (P12) - remplace l'ancien accès direct via documentFilePath()+readFile(). */
export async function readDocumentFile(cheminFichier: string): Promise<Buffer> {
  return getDocumentStorageProvider().read(cheminFichier);
}

export async function deleteDocumentFile(cheminFichier: string): Promise<void> {
  await getDocumentStorageProvider().delete(cheminFichier);
}

/** URL signée courte durée (P12, section 9) - null si le provider actif ne le supporte pas (ex. local : téléchargement via le backend à la place). */
export async function getSignedDocumentUrl(cheminFichier: string, expiresInSeconds = 300): Promise<string | null> {
  return getDocumentStorageProvider().getSignedUrl(cheminFichier, expiresInSeconds);
}
