// Les 8 départements d'Île-de-France - fait géographique stable, jamais une
// règle métier modifiable (contrairement aux tarifs qui en dépendent).
const DEPARTEMENTS_IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);

// null = code postal absent/invalide - ne jamais deviner une zone.
export function estCodePostalIdf(codePostal: string | null | undefined): boolean | null {
  const departement = codePostal?.trim().slice(0, 2);
  if (!departement || !/^\d{2}$/.test(departement)) return null;
  return DEPARTEMENTS_IDF.has(departement);
}
