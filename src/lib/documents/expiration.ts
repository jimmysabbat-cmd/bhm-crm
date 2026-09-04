// ============================================================
// Expiration documentaire (P10, section 7) - calcul DYNAMIQUE, jamais de
// cron : un document expiré le devient simplement dès que la date du jour
// dépasse dateExpiration, recalculé à chaque lecture.
// ============================================================

export function isDocumentExpired(doc: { dateExpiration: Date | null }, now: Date = new Date()): boolean {
  if (!doc.dateExpiration) return false;
  return doc.dateExpiration.getTime() < now.getTime();
}

/** Calcule dateExpiration à partir de validiteJours (exigence) et d'une date de référence (upload/validation). */
export function computeExpirationDate(validiteJours: number | null, fromDate: Date = new Date()): Date | null {
  if (validiteJours == null) return null;
  const d = new Date(fromDate);
  d.setDate(d.getDate() + validiteJours);
  return d;
}
