// Normalisation téléphone (P9, section 16) - helper central réutilisé
// partout où un doublon doit être détecté (Lead, Client, import CSV).
// Ne détruit jamais la saisie originale : le champ brut (telephone) reste
// affiché tel quel, seul telephoneNormalise sert à comparer.
//
// Portée volontairement limitée aux numéros français (mobile/fixe à 9
// chiffres après l'indicatif) - un numéro international non FR renvoie
// null plutôt qu'une normalisation approximative.
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s.\-()]/g, "");
  if (cleaned.length === 0) return null;

  let digits: string;
  if (cleaned.startsWith("+33")) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith("0033")) {
    digits = cleaned.slice(4);
  } else if (cleaned.startsWith("+")) {
    return null;
  } else if (cleaned.startsWith("0")) {
    digits = cleaned.slice(1);
  } else {
    digits = cleaned;
  }

  if (!/^\d{9}$/.test(digits)) return null;
  return `+33${digits}`;
}

export function formatPhoneForDisplay(normalise: string | null | undefined): string {
  if (!normalise || !normalise.startsWith("+33")) return normalise ?? "—";
  const digits = `0${normalise.slice(3)}`;
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}
