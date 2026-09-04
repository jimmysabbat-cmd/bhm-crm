// ============================================================
// Rendu de templates email (P11, section 6) - variables WHITELISTÉES
// uniquement, jamais de code injectable. Le renderer ne fait AUCUNE
// traversée dynamique de propriétés : l'appelant doit fournir un objet
// plat {"client.prenom": "Jean", ...} déjà résolu depuis des données
// métier, et seules les clés listées dans ALLOWED_VARIABLES sont acceptées
// - une variable inconnue dans le template est une erreur contrôlée
// (jamais un rendu silencieux ni une exécution de code).
// ============================================================

export const ALLOWED_VARIABLES = [
  "client.prenom",
  "client.nom",
  "client.civilite",
  "dossier.reference",
  "dossier.adresse",
  "documents.manquants",
  "document.nom",
  "document.motifRefus",
  "rdv.date",
  "rdv.type",
  "rdv.adresse",
  "commercial.nom",
  "organisation.nom",
] as const;

export type AllowedVariable = (typeof ALLOWED_VARIABLES)[number];

export type TemplateVariables = Partial<Record<AllowedVariable, string>>;

export class UnknownTemplateVariableError extends Error {
  constructor(public readonly variable: string) {
    super(`Variable de template inconnue : {{${variable}}} - non whitelistée.`);
    this.name = "UnknownTemplateVariableError";
  }
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Remplace {{variable}} par sa valeur dans `variables`. Toute variable
 * absente de ALLOWED_VARIABLES (donc jamais fournie par un appelant sûr)
 * lève UnknownTemplateVariableError - aucun rendu partiel silencieux.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(VARIABLE_PATTERN, (_match, rawName: string) => {
    if (!(ALLOWED_VARIABLES as readonly string[]).includes(rawName)) {
      throw new UnknownTemplateVariableError(rawName);
    }
    const value = variables[rawName as AllowedVariable];
    return value ?? "";
  });
}

/** Vérifie qu'un template ne référence que des variables whitelistées, sans le rendre. */
export function validateTemplateVariables(template: string): { valid: boolean; unknownVariables: string[] } {
  const unknown = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(VARIABLE_PATTERN);
  while ((match = pattern.exec(template)) !== null) {
    if (!(ALLOWED_VARIABLES as readonly string[]).includes(match[1])) unknown.add(match[1]);
  }
  return { valid: unknown.size === 0, unknownVariables: Array.from(unknown) };
}

/**
 * Construit la liste de pièces manquantes formatée pour {{documents.manquants}}
 * (section 8) - jamais une pièce déjà valide/fournie, une ligne par pièce.
 */
export function formatMissingDocumentsList(documents: { typeDocumentNom: string }[]): string {
  return documents.map((d) => `- ${d.typeDocumentNom}`).join("\n");
}
