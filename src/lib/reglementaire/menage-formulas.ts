// ============================================================
// Moteur de formules "ménage/revenus" whitelisté (P14). Même philosophie de
// sécurité que src/lib/reglementaire/formulas.ts (CEE) : AUCUN eval(),
// AUCUNE formule arbitraire chargée depuis la base ou l'UI. Volontairement
// un registre SÉPARÉ de FORMULES (cumac) plutôt qu'une entrée ajoutée au
// même registre : la forme de résultat est différente (catégorie de
// ménage, jamais un kWh cumac) et mélanger les deux romprait le typage fort
// déjà en place côté moteur CEE - le principe (données -> BaremeReglementaire,
// logique -> code testé) reste identique.
// ============================================================

import type { Precarite } from "@/generated/prisma/enums";

export type MenageBaremeMap = Record<string, number>;

export type MenageFormulaResult = {
  categorie: Precarite | null;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
};

export type MenageFormulaFn = (inputs: Record<string, unknown>, bareme: MenageBaremeMap) => MenageFormulaResult;

const CATEGORIES_ORDRE: Precarite[] = ["TRES_MODESTE", "MODESTE", "INTERMEDIAIRE", "SUPERIEUR"];

// Nombre de personnes maximum pour lequel un seuil de base est directement
// tabulé dans le barème - au-delà, on applique la majoration par personne
// supplémentaire (bareme["MAJORATION_PERSONNE_SUP|{categorie}|{zone}"]).
// Cette constante est un choix de STRUCTURE de clé (convention de nommage),
// jamais un seuil réglementaire - aucune valeur officielle n'est codée ici.
const NB_PERSONNES_BASE_MAX = 5;

/**
 * ANAH_REVENUS_V1 : détermine la catégorie de ménage (TRES_MODESTE ->
 * SUPERIEUR) à partir du RFR, du nombre de personnes du foyer et de la
 * zone. Compare le RFR aux seuils successifs (du plus bas au plus élevé) et
 * retient la première catégorie dont le seuil n'est pas dépassé. Si un
 * seuil nécessaire n'existe pas dans le barème (aucune donnée officielle
 * vérifiée configurée), retourne categorie: null avec un missingField
 * explicite - NE DEVINE JAMAIS une catégorie par défaut.
 */
function anahRevenusV1(inputs: Record<string, unknown>, bareme: MenageBaremeMap): MenageFormulaResult {
  const zoneClimatique = inputs.zoneClimatique as string | null | undefined;
  const nombrePersonnes = inputs.nombrePersonnesFoyer as number | null | undefined;
  const revenuFiscalReference = inputs.revenuFiscalReference as number | null | undefined;

  const missingFields: string[] = [];
  if (!zoneClimatique) missingFields.push("zoneClimatique");
  if (nombrePersonnes == null || Number.isNaN(nombrePersonnes) || nombrePersonnes <= 0) missingFields.push("nombrePersonnesFoyer");
  if (revenuFiscalReference == null || Number.isNaN(revenuFiscalReference) || revenuFiscalReference < 0) missingFields.push("revenuFiscalReference");
  if (missingFields.length > 0) {
    return { categorie: null, reasons: [], warnings: [], missingFields };
  }

  const nbEffectif = Math.min(nombrePersonnes!, NB_PERSONNES_BASE_MAX);
  const nbSupplementaires = Math.max(nombrePersonnes! - NB_PERSONNES_BASE_MAX, 0);

  const seuils: Partial<Record<Precarite, number>> = {};
  const seuilsIndisponibles: string[] = [];

  for (const categorie of CATEGORIES_ORDRE) {
    const cleBase = `${categorie}|${zoneClimatique}|${nbEffectif}`;
    const seuilBase = bareme[cleBase];
    if (seuilBase == null) {
      seuilsIndisponibles.push(cleBase);
      continue;
    }
    if (nbSupplementaires === 0) {
      seuils[categorie] = seuilBase;
      continue;
    }
    const cleMajoration = `MAJORATION_PERSONNE_SUP|${categorie}|${zoneClimatique}`;
    const majoration = bareme[cleMajoration];
    if (majoration == null) {
      seuilsIndisponibles.push(cleMajoration);
      continue;
    }
    seuils[categorie] = seuilBase + nbSupplementaires * majoration;
  }

  if (Object.keys(seuils).length === 0) {
    return {
      categorie: null,
      reasons: [
        `Aucun seuil ANAH_REVENUS configuré pour zone ${zoneClimatique}, ${nombrePersonnes} personne(s) - barème non configuré/à valider.`,
      ],
      warnings: [],
      missingFields: [],
    };
  }

  for (const categorie of CATEGORIES_ORDRE) {
    const seuil = seuils[categorie];
    if (seuil != null && revenuFiscalReference! <= seuil) {
      return {
        categorie,
        reasons: [
          `RFR ${revenuFiscalReference} <= seuil ${categorie} (${seuil}) pour zone ${zoneClimatique}, ${nombrePersonnes} personne(s).`,
        ],
        warnings: seuilsIndisponibles.length > 0 ? [`Seuils non configurés (ignorés dans la comparaison) : ${seuilsIndisponibles.join(", ")}`] : [],
        missingFields: [],
      };
    }
  }

  // RFR au-dessus de tous les seuils configurés -> catégorie la plus haute
  // effectivement configurée (jamais une catégorie inventée au-delà).
  const derniereConfiguree = [...CATEGORIES_ORDRE].reverse().find((c) => seuils[c] != null) ?? null;
  return {
    categorie: derniereConfiguree,
    reasons: derniereConfiguree
      ? [`RFR ${revenuFiscalReference} au-dessus de tous les seuils configurés - catégorie retenue : ${derniereConfiguree}.`]
      : [],
    warnings: seuilsIndisponibles.length > 0 ? [`Seuils non configurés (ignorés dans la comparaison) : ${seuilsIndisponibles.join(", ")}`] : [],
    missingFields: [],
  };
}

export const FORMULES_MENAGE = {
  ANAH_REVENUS_V1: { fn: anahRevenusV1, label: "ANAH revenus — catégorie de ménage v1 (RFR + composition foyer + zone)" },
} as const;

export type FormulaCodeMenage = keyof typeof FORMULES_MENAGE;

export function isKnownFormulaCodeMenage(code: string): code is FormulaCodeMenage {
  return code in FORMULES_MENAGE;
}
