import type { StatutMouvementFinancier } from "@/generated/prisma/enums";

const STATUTS_MOUVEMENT_TERMINAUX: StatutMouvementFinancier[] = ["RECU", "PAYE", "ANNULE"];

export function mouvementIsLate(mouvement: {
  statut: StatutMouvementFinancier;
  datePrevue: Date | null;
}): boolean {
  if (!mouvement.datePrevue) return false;
  if (STATUTS_MOUVEMENT_TERMINAUX.includes(mouvement.statut)) return false;
  return mouvement.datePrevue.getTime() < Date.now();
}

export function mouvementJoursRetard(mouvement: {
  statut: StatutMouvementFinancier;
  datePrevue: Date | null;
}): number {
  if (!mouvementIsLate(mouvement) || !mouvement.datePrevue) return 0;
  return Math.floor((Date.now() - mouvement.datePrevue.getTime()) / 86_400_000);
}

// calculateBlockedAmountForDossier/ByFlux vivent désormais dans
// financial-engine.ts (P6B, section 4 : "une fonction centrale utilisée
// par..." plutôt qu'une implémentation dupliquée ici) - réexportées sous
// leur nom d'origine pour ne pas casser les imports existants
// (next-best-action.ts, fiche dossier, dashboard).
export {
  calculateBlockedAmountForDossier,
  calculateBlockedAmountByFlux,
  type MontantBloque,
  type MontantBloqueDetail,
  type MontantBloqueParFlux,
} from "./financial-engine";
