import type { Precarite } from "@/generated/prisma/enums";
import { getApplicableRuleVersion, buildProvenance } from "./engine";
import { FORMULES_MENAGE, isKnownFormulaCodeMenage, type MenageBaremeMap } from "./menage-formulas";

// ============================================================
// Calcul de catégorie de ménage (ANAH_REVENUS), P14. RÉUTILISE
// intégralement RegleReglementaire/RegleReglementaireVersion/
// BaremeReglementaire (getApplicableRuleVersion est générique, déjà
// exporté par ./engine.ts) - aucune nouvelle table réglementaire. Le code
// de fiche conventionnel pour cette famille est "ANAH_REVENUS" (une
// RegleReglementaire avec ce code doit exister, comme "BAR-TH-171" pour le
// CEE). Tant qu'aucune version PUBLIÉE de cette règle n'existe (barème
// officiel non vérifié disponible dans ce repo), ce calcul retourne
// toujours "barème non configuré" - il n'invente JAMAIS de seuil.
// ============================================================

export const ANAH_REVENUS_CODE = "ANAH_REVENUS";

export type CategorieMenageResult = {
  statut: "CALCULE" | "DONNEES_INSUFFISANTES" | "BAREME_NON_CONFIGURE" | "BLOQUE";
  categorie: Precarite | null;
  ruleVersionId: string | null;
  formulaCode: string | null;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  provenance: string | null;
};

/**
 * API métier centrale du calcul de catégorie de ménage. Ne retourne
 * JAMAIS une catégorie inventée : si aucune RegleReglementaireVersion
 * publiée n'existe pour ANAH_REVENUS (barème non encore configuré/vérifié
 * par un admin via l'écran Paramétrage/Règles réglementaires), le statut
 * est BAREME_NON_CONFIGURE et categorie reste null.
 */
export async function calculateCategorieMenage(params: {
  dateReference: Date;
  inputs: { zoneClimatique: string | null; nombrePersonnesFoyer: number | null; revenuFiscalReference: number | null };
}): Promise<CategorieMenageResult> {
  const base = { reasons: [] as string[], warnings: [] as string[] };

  const version = await getApplicableRuleVersion(ANAH_REVENUS_CODE, params.dateReference);
  if (!version) {
    return {
      ...base,
      statut: "BAREME_NON_CONFIGURE",
      categorie: null,
      ruleVersionId: null,
      formulaCode: null,
      missingFields: [],
      reasons: ["Aucune version publiée de la règle ANAH_REVENUS n'est configurée - barème non configuré / à confirmer."],
      provenance: null,
    };
  }

  if (!isKnownFormulaCodeMenage(version.formulaCode)) {
    return {
      ...base,
      statut: "BLOQUE",
      categorie: null,
      ruleVersionId: version.id,
      formulaCode: version.formulaCode,
      missingFields: [],
      reasons: [`Code de formule "${version.formulaCode}" inconnu du moteur ménage - calcul bloqué (jamais d'exécution de code non whitelisté).`],
      provenance: buildProvenance(version),
    };
  }

  const bareme: MenageBaremeMap = {};
  for (const b of version.baremes) bareme[b.cle] = b.valeur;

  const formula = FORMULES_MENAGE[version.formulaCode];
  const result = formula.fn(params.inputs, bareme);

  let statut: CategorieMenageResult["statut"];
  if (result.missingFields.length > 0) statut = "DONNEES_INSUFFISANTES";
  else if (result.categorie == null) statut = "BAREME_NON_CONFIGURE";
  else statut = "CALCULE";

  return {
    statut,
    categorie: result.categorie,
    ruleVersionId: version.id,
    formulaCode: version.formulaCode,
    reasons: result.reasons,
    warnings: result.warnings,
    missingFields: result.missingFields,
    provenance: buildProvenance(version),
  };
}
