// ============================================================
// Abstraction de stockage documentaire (P12, section 7) - BLOCKER go-live
// identifié : le CRM ne doit plus dépendre directement du filesystem
// local pour sa logique métier (incompatible avec un hébergement
// serverless/éphémère). `key` remplace `cheminFichier` comme identifiant
// opaque du fichier stocké - jamais un chemin filesystem construit ailleurs
// que dans l'implémentation du provider actif.
// ============================================================

export type StoredFile = {
  key: string;
  nomFichier: string;
  mimeType: string;
  tailleOctets: number;
};

export interface DocumentStorageProvider {
  readonly name: string;
  save(dossierId: string, file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<StoredFile>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * URL signée courte durée pour un téléchargement direct (section 9) -
   * optionnel : un provider local peut ne pas le supporter (retourne
   * null), auquel cas l'appelant sert le fichier lui-même via
   * read()+réponse HTTP (comme aujourd'hui).
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}
