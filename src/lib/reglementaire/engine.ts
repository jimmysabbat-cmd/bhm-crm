import { prisma } from "@/lib/prisma";
import { FORMULES, isKnownFormulaCode, type BaremeMap } from "./formulas";
import { compareCeeDelegates, type CeeDelegateComparison } from "./valuation";
import type { StatutEligibiliteReglementaire } from "@/generated/prisma/enums";

// ============================================================
// Moteur réglementaire versionné (P7) - fonctions centrales.
//
// Répond aux 9 questions du prompt (section "OBJECTIF CENTRAL") : quelle
// règle, quelle version à la date d'engagement, éligibilité, données
// manquantes, kWh cumac, valorisation (cf. valuation.ts), provenance,
// figeage historique. Additif : ne touche jamais aux calculateurs
// existants (CeeCumacCalculator.tsx, champs montantCumac/
// montantPrimeCalculeCts) - fonctionne en parallèle.
// ============================================================

export type RuleVersionWithRelations = Awaited<ReturnType<typeof getApplicableRuleVersion>>;

/**
 * Sélectionne LA version publiée d'une règle en vigueur à une date donnée
 * (section 2) : dateDebutEffet <= dateEngagement ET (dateFinEffet null OU
 * dateEngagement <= dateFinEffet). Ne retourne JAMAIS "la dernière version"
 * par défaut - un dossier historique doit continuer à utiliser la version
 * qui était en vigueur à SA date d'engagement, jamais la version courante
 * (section 9).
 */
export async function getApplicableRuleVersion(code: string, dateEngagement: Date) {
  return prisma.regleReglementaireVersion.findFirst({
    where: {
      regle: { code },
      publie: true,
      dateDebutEffet: { lte: dateEngagement },
      OR: [{ dateFinEffet: null }, { dateFinEffet: { gte: dateEngagement } }],
    },
    include: { regle: true, baremes: true },
    orderBy: { dateDebutEffet: "desc" },
  });
}

/**
 * Meilleur champ existant pour la date d'engagement d'un dossier (section
 * 21) : la date de signature du devis est la donnée métier la plus proche
 * de "l'engagement" au sens réglementaire CEE (le client s'est engagé sur
 * les travaux). Ne suppose jamais silencieusement une date : si absente,
 * retourne null et le calcul doit répondre DONNEES_INSUFFISANTES.
 */
export function getDossierEngagementDate(dossier: { dateSignatureDevis: Date | null }): Date | null {
  return dossier.dateSignatureDevis;
}

/** Explique la provenance d'un résultat réglementaire (section 22) - jamais une boîte noire. */
export function buildProvenance(version: {
  numeroVersion: string;
  dateDebutEffet: Date;
  dateFinEffet: Date | null;
  sourceNom: string;
  sourceReference: string | null;
  regle: { code: string };
}): string {
  const debut = version.dateDebutEffet.toLocaleDateString("fr-FR");
  const fin = version.dateFinEffet ? version.dateFinEffet.toLocaleDateString("fr-FR") : "aujourd'hui (pas de fin connue)";
  const ref = version.sourceReference ? ` (${version.sourceReference})` : "";
  return `${version.regle.code} version ${version.numeroVersion}, applicable du ${debut} au ${fin}. Source : ${version.sourceNom}${ref}.`;
}

export type CeeCumacResult = {
  statutEligibilite: StatutEligibiliteReglementaire;
  kwhCumac: number | null;
  ruleVersionId: string | null;
  formulaCode: string | null;
  parametersUsed: Record<string, unknown>;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  provenance: string | null;
};

/**
 * API métier centrale du calcul cumac (section 9). Toutes les valeurs
 * utilisées sont auditables via ruleVersionId + parametersUsed.
 * IMPORTANT : ne retourne jamais ELIGIBLE de façon certaine - une fiche CEE
 * nécessite toujours une confirmation documentaire/qualification externe
 * (RGE, attestation...) que ce moteur ne vérifie pas ; le statut le plus
 * favorable qu'il retourne est ELIGIBLE_PROBABLE (section 3).
 */
export async function calculateCeeCumac(params: {
  ficheCode: string;
  dateEngagement: Date | null;
  inputs: Record<string, unknown>;
}): Promise<CeeCumacResult> {
  const base = {
    parametersUsed: params.inputs,
    reasons: [] as string[],
    warnings: [] as string[],
  };

  if (!params.dateEngagement) {
    return {
      ...base,
      statutEligibilite: "DONNEES_INSUFFISANTES",
      kwhCumac: null,
      ruleVersionId: null,
      formulaCode: null,
      missingFields: ["dateEngagement"],
      provenance: null,
    };
  }

  const version = await getApplicableRuleVersion(params.ficheCode, params.dateEngagement);
  if (!version) {
    return {
      ...base,
      statutEligibilite: "DONNEES_INSUFFISANTES",
      kwhCumac: null,
      ruleVersionId: null,
      formulaCode: null,
      missingFields: [],
      reasons: [`Aucune version publiée de ${params.ficheCode} n'est en vigueur au ${params.dateEngagement.toLocaleDateString("fr-FR")}.`],
      provenance: null,
    };
  }

  if (!isKnownFormulaCode(version.formulaCode)) {
    return {
      ...base,
      statutEligibilite: "BLOQUE",
      kwhCumac: null,
      ruleVersionId: version.id,
      formulaCode: version.formulaCode,
      missingFields: [],
      reasons: [`Code de formule "${version.formulaCode}" inconnu du moteur - calcul bloqué (jamais d'exécution de code non whitelisté).`],
      provenance: buildProvenance(version),
    };
  }

  const bareme: BaremeMap = {};
  for (const b of version.baremes) bareme[b.cle] = b.valeur;

  const formula = FORMULES[version.formulaCode];
  const result = formula.fn(params.inputs, bareme);

  let statutEligibilite: StatutEligibiliteReglementaire;
  if (result.missingFields.length > 0) statutEligibilite = "DONNEES_INSUFFISANTES";
  else if (result.kwhCumac == null) statutEligibilite = "A_CONFIRMER";
  else statutEligibilite = "ELIGIBLE_PROBABLE";

  return {
    statutEligibilite,
    kwhCumac: result.kwhCumac,
    ruleVersionId: version.id,
    formulaCode: version.formulaCode,
    parametersUsed: params.inputs,
    reasons: result.reasons,
    warnings: result.warnings,
    missingFields: result.missingFields,
    provenance: buildProvenance(version),
  };
}

export type CeeScenarioResult = CeeCumacResult & { delegates: CeeDelegateComparison[] };

/**
 * simulateCeeScenario (section 26) : ne sauvegarde RIEN par défaut. Combine
 * calculateCeeCumac + compareCeeDelegates pour donner une vue complète
 * (éligibilité, cumac, comparatif délégataires) utilisable pour une étude
 * commerciale, avant tout engagement du dossier.
 */
export async function simulateCeeScenario(params: {
  organisationId: string;
  ficheCode: string;
  dateEngagement: Date | null;
  inputs: Record<string, unknown>;
  categorie: string;
}): Promise<CeeScenarioResult> {
  const cumacResult = await calculateCeeCumac({
    ficheCode: params.ficheCode,
    dateEngagement: params.dateEngagement,
    inputs: params.inputs,
  });

  const delegates =
    cumacResult.kwhCumac != null
      ? await compareCeeDelegates({
          organisationId: params.organisationId,
          kwhCumac: cumacResult.kwhCumac,
          ficheCode: params.ficheCode,
          categorie: params.categorie,
          date: params.dateEngagement ?? new Date(),
        })
      : [];

  return { ...cumacResult, delegates };
}

/**
 * Un override réglementaire (section 23/24/29) exige toujours une raison -
 * fonction pure, réutilisée par overrideCalculReglementaire et testable
 * indépendamment de toute session (cf. scripts/test-reglementaire-engine.ts).
 */
export function validateOverrideReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) {
    throw new Error("Une raison est obligatoire pour justifier un override réglementaire.");
  }
  return trimmed;
}

/**
 * TEST C (section 28) : une version publiée et potentiellement déjà
 * utilisée ne peut plus voir ses paramètres structurels (barème) modifiés -
 * fonction pure, réutilisée par modifierBaremeReglementaire et testable
 * isolément.
 */
export function assertRuleVersionEditable(version: { publie: boolean }): void {
  if (version.publie) {
    throw new Error("Cette version est publiée : ses paramètres structurels ne peuvent plus être modifiés.");
  }
}
