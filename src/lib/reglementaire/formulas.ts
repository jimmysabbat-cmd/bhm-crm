// ============================================================
// Moteur de formules réglementaires whitelisté (P7, section 5).
//
// JAMAIS de eval() ni de formule arbitraire chargée depuis la base ou
// l'UI. Chaque formule est une fonction TypeScript connue et testée,
// enregistrée ici sous un code stable (ex. "BAR_TH_171_CUMAC_V1"). Les
// VALEURS réglementaires (coefficients, forfaits) ne sont jamais codées en
// dur dans ces fonctions : elles viennent du BaremeReglementaire de la
// version en vigueur, injecté en paramètre. Ainsi :
//   - données réglementaires -> BaremeReglementaire (base, versionné)
//   - logique de calcul      -> ce fichier (code, testé, jamais dynamique)
//   - code UI                -> composants React (jamais de calcul ici)
// ============================================================

export type BaremeMap = Record<string, number>;

export type FormulaResult = {
  kwhCumac: number | null;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
};

export type FormulaFn = (inputs: Record<string, unknown>, bareme: BaremeMap) => FormulaResult;

// --- BAR-TH-171 (PAC air/eau) — fiche pilote (section 7 du prompt) ---------
//
// Reproduit EXACTEMENT le comportement de l'ancien calculateur
// (src/components/ui/CeeCumacCalculator.tsx) : mêmes variables d'entrée
// (zone climatique, surface chauffée, bande ETAS), même règle de
// tranchage de surface (<70 / 70-90 / ≥90 m²), même clé de lookup dans le
// barème. La table de valeurs elle-même est déplacée en
// BaremeReglementaire (seedée avec les valeurs exactes de l'ancien
// calculateur, cf. prisma/seed-reglementaire.ts) - aucune valeur n'est
// modifiée ni inventée ici.

export type BarTh171SurfaceTranche = "moins70" | "70a90" | "plus90";
export type BarTh171EtasBande = "111a140" | "plus140";

export function barTh171SurfaceTranche(surfaceM2: number): BarTh171SurfaceTranche {
  if (surfaceM2 < 70) return "moins70";
  if (surfaceM2 < 90) return "70a90";
  return "plus90";
}

function barTh171CumacV1(inputs: Record<string, unknown>, bareme: BaremeMap): FormulaResult {
  const zoneClimatique = inputs.zoneClimatique as string | null | undefined;
  const surfaceChauffeeM2 = inputs.surfaceChauffeeM2 as number | null | undefined;
  const etasBande = inputs.etasBande as BarTh171EtasBande | null | undefined;

  const missingFields: string[] = [];
  if (!zoneClimatique) missingFields.push("zoneClimatique");
  if (surfaceChauffeeM2 == null || Number.isNaN(surfaceChauffeeM2) || surfaceChauffeeM2 <= 0) missingFields.push("surfaceChauffeeM2");
  if (!etasBande) missingFields.push("etasBande");
  if (missingFields.length > 0) {
    return { kwhCumac: null, reasons: [], warnings: [], missingFields };
  }

  const tranche = barTh171SurfaceTranche(surfaceChauffeeM2!);
  const cle = `${zoneClimatique}|${tranche}|${etasBande}`;
  const kwhCumac = bareme[cle];

  if (kwhCumac == null) {
    return {
      kwhCumac: null,
      reasons: [`Aucun forfait BAR-TH-171 connu pour zone ${zoneClimatique}, surface ${tranche}, ETAS ${etasBande}.`],
      warnings: [],
      missingFields: [],
    };
  }

  return {
    kwhCumac,
    reasons: [`Forfait BAR-TH-171 : zone ${zoneClimatique}, surface chauffée ${surfaceChauffeeM2} m² (tranche ${tranche}), ETAS ${etasBande}.`],
    warnings: [],
    missingFields: [],
  };
}

export const FORMULES = {
  BAR_TH_171_CUMAC_V1: { fn: barTh171CumacV1, label: "BAR-TH-171 — Cumac PAC air/eau v1 (parité avec l'ancien calculateur)" },
} as const;

export type FormulaCode = keyof typeof FORMULES;

export function isKnownFormulaCode(code: string): code is FormulaCode {
  return code in FORMULES;
}
