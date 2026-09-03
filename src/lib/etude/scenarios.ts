import { calculateSorties, getEntreeLignesForDossier, type Confidence } from "@/lib/financial-engine";
import { calculateCeeCumac, getApplicableRuleVersion, buildProvenance } from "@/lib/reglementaire/engine";
import { compareCeeDelegates } from "@/lib/reglementaire/valuation";
import type { Precarite } from "@/generated/prisma/enums";
import type {
  StudyContext,
  StudyScenario,
  ScenarioMargin,
  ScenarioCostStatus,
  ScenarioCashRequirement,
  ScenarioDelaiEncaissement,
  ReglementaireProvenanceScenario,
  ConfianceSourceReglementaire,
} from "./types";

// ============================================================
// Génération des scénarios d'étude (P8, section 5/6).
//
// Le moteur ne propose que ce que les règles/tarifs réellement disponibles
// permettent de calculer (section 5) : aujourd'hui, seule la fiche
// BAR-TH-171 (PAC air/eau) est migrée dans le moteur réglementaire P7 -
// aucune autre fiche n'est simulée, même approximativement. Toute la
// logique de calcul cumac/valorisation est réutilisée telle quelle depuis
// financial-engine.ts / reglementaire/engine.ts / reglementaire/valuation.ts
// - jamais recalculée en double (section 37 du prompt P8).
// ============================================================

// Même convention binaire que next-best-action.ts (P5/P7) : le CRM ne
// distingue aujourd'hui que "très modeste" vs "le reste" pour les tarifs
// délégataires CEE.
function categorieCeeFromPrecarite(precarite: Precarite | null): "TRES_MODESTE" | "CLASSIQUE" {
  return precarite === "TRES_MODESTE" ? "TRES_MODESTE" : "CLASSIQUE";
}

// --- Reste à charge (section 7) ---------------------------------------------

/**
 * Reste à charge = montant contractuel - financements/aides venant payer CE
 * MÊME contrat. Ne jamais additionner les aides au CA (section 7/8 du
 * prompt P8, principe repris du P6).
 */
export function calculateCustomerRemainingCharge(params: { caContractuelCts: number; aides: { montantCts: number }[] }): number {
  const totalAides = params.aides.reduce((sum, a) => sum + a.montantCts, 0);
  return Math.max(params.caContractuelCts - totalAides, 0);
}

// --- Marge (section 10) -----------------------------------------------------

export function calculateScenarioMargin(params: {
  caCts: number;
  coutsCts: number;
  costStatus: ScenarioCostStatus;
  caConfidence: Confidence;
}): ScenarioMargin {
  const margeCts = params.caCts - params.coutsCts;
  const margePct = params.caCts > 0 ? (margeCts / params.caCts) * 100 : null;

  const missingFields: string[] = [];
  let confidence: ScenarioMargin["confidence"];
  if (params.caConfidence === "LOW") {
    confidence = "NON_CALCULABLE";
    missingFields.push("caContractuel");
  } else if (params.costStatus === "INCOMPLETE") {
    confidence = "ESTIMATION_INCOMPLETE";
    missingFields.push("coutsPrevus");
  } else {
    confidence = "FIABLE";
  }

  return { caCts: params.caCts, coutsCts: params.coutsCts, margeCts, margePct, confidence, missingFields };
}

// --- Besoin de trésorerie (section 11) --------------------------------------

/**
 * Estime combien l'entreprise doit potentiellement avancer avant
 * encaissement. Ne prétend JAMAIS connaître un solde bancaire réel
 * (section 11) - seulement une estimation simple et documentée à partir des
 * données réellement disponibles (mouvements financiers, sinon coûts des
 * postes de travaux).
 */
export async function calculateScenarioCashRequirement(params: {
  dossierId: string;
  coutsPrevusCts: number;
  posteBreakdown: { label: string; montantCts: number }[];
}): Promise<ScenarioCashRequirement> {
  const [sorties, lignesEntree] = await Promise.all([calculateSorties(params.dossierId), getEntreeLignesForDossier(params.dossierId)]);

  const limites: string[] = [];
  let principalesSortiesAvantEntree: { label: string; montantCts: number }[];
  let montantAAvancerCts: number | null;

  if (sorties.details.length > 0) {
    principalesSortiesAvantEntree = sorties.details.filter((d) => d.resteCts > 0).map((d) => ({ label: d.label, montantCts: d.resteCts }));
    montantAAvancerCts = sorties.resteAPayerCts;
  } else if (params.posteBreakdown.length > 0) {
    principalesSortiesAvantEntree = params.posteBreakdown;
    montantAAvancerCts = params.posteBreakdown.reduce((s, b) => s + b.montantCts, 0);
    limites.push("Aucun mouvement financier de sortie enregistré : estimation basée sur les coûts des postes de travaux, pas sur des paiements réellement engagés.");
  } else {
    principalesSortiesAvantEntree = [];
    montantAAvancerCts = params.coutsPrevusCts > 0 ? params.coutsPrevusCts : null;
    if (montantAAvancerCts === null) limites.push("Aucune donnée de coût suffisante pour estimer un besoin de trésorerie.");
  }

  const lignesEntreeDatees = lignesEntree
    .filter((l) => l.datePrevue !== null && l.resteCts > 0)
    .sort((a, b) => a.datePrevue!.getTime() - b.datePrevue!.getTime());
  const premiereEntreeAttendue =
    lignesEntreeDatees.length > 0 ? { label: lignesEntreeDatees[0].categorieLabel, date: lignesEntreeDatees[0].datePrevue } : null;
  if (!premiereEntreeAttendue) limites.push("Aucune entrée datée connue : première rentrée non estimable.");

  // Pic de besoin : estimation simplifiée à un seul point (le montant total
  // à avancer), PAS une simulation jour par jour - cf. limites.
  const picDeBesoinCts = montantAAvancerCts !== null && premiereEntreeAttendue !== null ? montantAAvancerCts : null;
  if (montantAAvancerCts !== null && premiereEntreeAttendue === null) {
    limites.push("Pic de besoin non calculable sans échéance d'entrée connue.");
  }

  return { montantAAvancerCts, principalesSortiesAvantEntree, premiereEntreeAttendue, picDeBesoinCts, limites };
}

// --- Délai d'encaissement (section 12) --------------------------------------

/**
 * Estimation basée UNIQUEMENT sur des dates/délais réellement connus. Si
 * aucune donnée : "non estimable" - ne crée jamais une fausse date
 * (section 12 du prompt P8).
 */
export function estimateScenarioDelaiEncaissement(params: {
  dateEngagement: Date | null;
  dateDepotDelegataire: Date | null;
  delaiPaiementJours: number | null;
}): ScenarioDelaiEncaissement {
  const dateBase = params.dateDepotDelegataire ?? params.dateEngagement;
  if (!dateBase || params.delaiPaiementJours == null) {
    return { estimable: false, dateEstimee: null, joursEstimes: null, base: null };
  }
  const dateEstimee = new Date(dateBase);
  dateEstimee.setDate(dateEstimee.getDate() + params.delaiPaiementJours);
  return {
    estimable: true,
    dateEstimee,
    joursEstimes: params.delaiPaiementJours,
    base: params.dateDepotDelegataire
      ? "délai délégataire depuis la date de dépôt du dossier"
      : "délai délégataire depuis la date d'engagement (aucune date de dépôt connue)",
  };
}

// --- Provenance réglementaire (section 17/18) -------------------------------

function confianceSourceFromVersion(version: { commentaire: string | null }): ConfianceSourceReglementaire {
  // Convention : la mention "À VÉRIFIER" dans le commentaire de la version
  // (posée explicitement par le seed P7 pour BAR-TH-171, faute de source
  // PNCEE/ADEME jointe) signale une source non vérifiée. Pas de nouvelle
  // colonne : on réutilise une donnée déjà présente plutôt que d'ajouter un
  // champ structurel de plus pour un besoin qu'un texte documente déjà.
  const marque = (version.commentaire ?? "").toUpperCase().includes("À VÉRIFIER") || (version.commentaire ?? "").toUpperCase().includes("A VERIFIER");
  return marque ? "UNVERIFIED_SOURCE" : "VERIFIED_SOURCE";
}

// --- Génération des scénarios (section 5/6) ---------------------------------

async function buildScenarioForPoste(
  context: StudyContext,
  posteId: string,
  delegataire: { id: string; nom: string; primeCts: number; tauxCtsParMwhc: number; delaiPaiementJours: number | null } | null
): Promise<StudyScenario> {
  const poste = context.project.postes.find((p) => p.posteId === posteId)!;
  const regInputs = context.regulatoryInputs.find((r) => r.posteId === posteId)!;
  const warnings: string[] = [];
  const risques: string[] = [];
  const missingFields = [...regInputs.missingFields];
  const reasons: string[] = [];

  let statutEligibilite: StudyScenario["statutEligibilite"] = null;
  let ceeKwhCumac: number | null = null;
  let fichesReglementaires: ReglementaireProvenanceScenario[] = [];

  if (regInputs.ficheCode && regInputs.missingFields.length === 0) {
    const cumacResult = await calculateCeeCumac({
      ficheCode: regInputs.ficheCode,
      dateEngagement: context.project.dateEngagement.value,
      inputs: regInputs.inputs,
    });
    statutEligibilite = cumacResult.statutEligibilite;
    ceeKwhCumac = cumacResult.kwhCumac;
    reasons.push(...cumacResult.reasons);
    warnings.push(...cumacResult.warnings);
    missingFields.push(...cumacResult.missingFields);

    if (cumacResult.ruleVersionId) {
      const version = await getApplicableRuleVersion(regInputs.ficheCode, context.project.dateEngagement.value!);
      if (version) {
        const confianceSource = confianceSourceFromVersion(version);
        const avertissementSource =
          confianceSource === "UNVERIFIED_SOURCE"
            ? "Calcul reproduisant le barème historique du CRM ; source réglementaire officielle à vérifier."
            : null;
        fichesReglementaires = [
          {
            ficheCode: regInputs.ficheCode,
            ruleVersionId: version.id,
            numeroVersion: version.numeroVersion,
            dateDebutEffet: version.dateDebutEffet,
            dateFinEffet: version.dateFinEffet,
            sourceNom: version.sourceNom,
            provenance: buildProvenance(version),
            confianceSource,
            avertissementSource,
          },
        ];
        if (avertissementSource) warnings.push(avertissementSource);
      }
    }
  } else {
    statutEligibilite = "DONNEES_INSUFFISANTES";
  }

  const aides: { origine: string; montantCts: number }[] = [];
  if (context.financial.aideMprConnueCts > 0) aides.push({ origine: "ANAH / MPR (connue)", montantCts: context.financial.aideMprConnueCts });

  const delegataireNom = delegataire?.nom ?? null;
  const valorisationCeeCts = delegataire?.primeCts ?? null;
  if (valorisationCeeCts !== null) aides.push({ origine: `CEE (${delegataireNom})`, montantCts: valorisationCeeCts });
  else if (ceeKwhCumac !== null) warnings.push("Cumac calculé mais aucun tarif délégataire applicable : CEE non valorisé, non inclus dans le reste à charge.");

  const resteAChargeClientCts =
    ceeKwhCumac !== null && valorisationCeeCts === null ? null : calculateCustomerRemainingCharge({ caContractuelCts: context.financial.caContractuelCts, aides });

  const costStatus = context.financial.costStatus;
  const margin = calculateScenarioMargin({
    caCts: context.financial.caContractuelCts,
    coutsCts: context.financial.coutsPrevusCts,
    costStatus,
    caConfidence: context.financial.caConfidence,
  });

  const posteBreakdown: { label: string; montantCts: number }[] = [];
  if (poste.coutTTCCts.value) posteBreakdown.push({ label: `Matériel (${poste.typeTravaux})`, montantCts: poste.coutTTCCts.value });

  const cashRequirement = await calculateScenarioCashRequirement({
    dossierId: context.dossierId,
    coutsPrevusCts: context.financial.coutsPrevusCts,
    posteBreakdown,
  });

  const delaiEncaissement = estimateScenarioDelaiEncaissement({
    dateEngagement: context.project.dateEngagement.value,
    dateDepotDelegataire: context.project.dateDepotDelegataireCee.value,
    delaiPaiementJours: delegataire?.delaiPaiementJours ?? null,
  });

  if (statutEligibilite === "DONNEES_INSUFFISANTES") {
    risques.push("Éligibilité non confirmable en l'état : données réglementaires manquantes.");
  }
  if (costStatus === "INCOMPLETE") {
    risques.push("Coûts non tracés pour ce dossier : marge présentée à titre indicatif uniquement.");
  }

  const titre = delegataireNom ? `${poste.typeTravaux} — ${delegataireNom}` : `${poste.typeTravaux} — CEE non valorisé`;

  return {
    id: `poste:${posteId}:${delegataire?.id ?? "aucun"}`,
    titre,
    description: delegataireNom
      ? `Scénario ${regInputs.ficheCode ?? poste.typeTravaux} valorisé auprès de ${delegataireNom}.`
      : `Scénario ${regInputs.ficheCode ?? poste.typeTravaux} - aucun délégataire valorisé pour le moment.`,
    posteIds: [posteId],
    fichesReglementaires,
    statutEligibilite,
    aides,
    ceeKwhCumac,
    delegataireId: delegataire?.id ?? null,
    delegataireNom,
    valorisationCeeCts,
    delaiPaiementDelegataireJours: delegataire?.delaiPaiementJours ?? null,
    caContractuelCts: context.financial.caContractuelCts,
    resteAChargeClientCts,
    coutsPrevusCts: context.financial.coutsPrevusCts,
    costStatus,
    margin,
    cashRequirement,
    delaiEncaissement,
    risques,
    warnings,
    missingFields: Array.from(new Set(missingFields)),
    reasons,
    // score/recommandation renseignés par recommendations.ts (section 14/16)
    score: { score: 0, reasons: [] },
    recommandation: "IMPOSSIBLE_A_EVALUER",
    recommandationReasons: [],
  };
}

function buildBaselineScenario(context: StudyContext): StudyScenario {
  const aides: { origine: string; montantCts: number }[] = [];
  if (context.financial.aideMprConnueCts > 0) aides.push({ origine: "ANAH / MPR (connue)", montantCts: context.financial.aideMprConnueCts });
  if (context.financial.aideCeeConnueCts > 0) aides.push({ origine: "CEE (connue, hors moteur P7)", montantCts: context.financial.aideCeeConnueCts });

  const resteAChargeClientCts = calculateCustomerRemainingCharge({ caContractuelCts: context.financial.caContractuelCts, aides });
  const margin = calculateScenarioMargin({
    caCts: context.financial.caContractuelCts,
    coutsCts: context.financial.coutsPrevusCts,
    costStatus: context.financial.costStatus,
    caConfidence: context.financial.caConfidence,
  });

  return {
    id: "baseline",
    titre: "Scénario actuel (données du dossier)",
    description: "Reflète les montants déjà renseignés sur le dossier, sans nouveau calcul réglementaire (aucune fiche CEE migrée applicable ici).",
    posteIds: context.project.postes.map((p) => p.posteId),
    fichesReglementaires: [],
    statutEligibilite: null,
    aides,
    ceeKwhCumac: null,
    delegataireId: null,
    delegataireNom: null,
    valorisationCeeCts: null,
    delaiPaiementDelegataireJours: null,
    caContractuelCts: context.financial.caContractuelCts,
    resteAChargeClientCts,
    coutsPrevusCts: context.financial.coutsPrevusCts,
    costStatus: context.financial.costStatus,
    margin,
    cashRequirement: { montantAAvancerCts: null, principalesSortiesAvantEntree: [], premiereEntreeAttendue: null, picDeBesoinCts: null, limites: ["Scénario de référence : besoin de trésorerie non détaillé (aucun poste réglementaire simulé)."] },
    delaiEncaissement: { estimable: false, dateEstimee: null, joursEstimes: null, base: null },
    risques: [],
    warnings: [],
    missingFields: context.missingFields,
    reasons: ["Reprend le CA contractuel et les coûts prévus déjà renseignés sur le dossier."],
    score: { score: 0, reasons: [] },
    recommandation: "IMPOSSIBLE_A_EVALUER",
    recommandationReasons: [],
  };
}

/**
 * Génère les scénarios d'un dossier (section 5/6 du prompt P8). Ne propose
 * que ce que les règles/tarifs disponibles permettent réellement de
 * calculer - jamais de fiche non migrée simulée, même approximativement.
 */
export async function generateStudyScenarios(context: StudyContext): Promise<StudyScenario[]> {
  const postesAvecFiche = context.project.postes.filter((p) => {
    const ri = context.regulatoryInputs.find((r) => r.posteId === p.posteId);
    return ri?.ficheCode != null;
  });

  if (postesAvecFiche.length === 0) {
    return [buildBaselineScenario(context)];
  }

  const scenarios: StudyScenario[] = [];
  for (const poste of postesAvecFiche) {
    const regInputs = context.regulatoryInputs.find((r) => r.posteId === poste.posteId)!;

    if (regInputs.missingFields.length > 0 || !context.project.dateEngagement.value) {
      scenarios.push(await buildScenarioForPoste(context, poste.posteId, null));
      continue;
    }

    const cumacResult = await calculateCeeCumac({
      ficheCode: regInputs.ficheCode!,
      dateEngagement: context.project.dateEngagement.value,
      inputs: regInputs.inputs,
    });

    if (cumacResult.kwhCumac == null) {
      scenarios.push(await buildScenarioForPoste(context, poste.posteId, null));
      continue;
    }

    const delegates = await compareCeeDelegates({
      organisationId: context.organisationId,
      kwhCumac: cumacResult.kwhCumac,
      ficheCode: regInputs.ficheCode!,
      categorie: categorieCeeFromPrecarite(context.client.precarite.value),
      date: context.project.dateEngagement.value,
    });

    if (delegates.length === 0) {
      scenarios.push(await buildScenarioForPoste(context, poste.posteId, null));
      continue;
    }

    for (const d of delegates) {
      scenarios.push(
        await buildScenarioForPoste(context, poste.posteId, {
          id: d.delegataireId,
          nom: d.delegataireNom,
          primeCts: d.primeCts,
          tauxCtsParMwhc: d.tauxCtsParMwhc,
          delaiPaiementJours: d.delaiPaiementJours,
        })
      );
    }
  }

  return scenarios;
}
