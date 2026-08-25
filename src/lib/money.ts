// Toutes les sommes sont stockées en centimes (Int) - jamais de float sur de l'argent.

export function centsToEuros(cents: number): number {
  return cents / 100;
}

export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

const formatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return formatter.format(centsToEuros(cents));
}
