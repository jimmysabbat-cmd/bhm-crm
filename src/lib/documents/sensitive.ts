// ============================================================
// Pièces sensibles (P10, section 33) - identité/fiscalité. Liste fermée de
// codes TypeDocumentReferentiel considérés sensibles ; volontairement une
// simple liste (pas un champ DB supplémentaire) pour rester lisible en un
// seul endroit sans complexifier le référentiel.
// ============================================================

const SENSITIVE_TYPE_CODES = new Set(["AVIS_IMPOSITION", "PIECE_IDENTITE", "TAXE_FONCIERE", "RIB"]);

export function isSensitiveTypeDocumentCode(code: string | null): boolean {
  if (!code) return false;
  return SENSITIVE_TYPE_CODES.has(code);
}
