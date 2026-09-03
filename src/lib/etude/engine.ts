import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { calculateContractualRevenue, calculateForecastCosts, calculateEntrees } from "@/lib/financial-engine";
import { generateStudyScenarios } from "./scenarios";
import { scoreAndRecommendScenarios, pickRecommendedScenario } from "./recommendations";
import { qualified, type StudyContext, type StudyDataQuality, type StudyRegulatoryInputs, type StudyMode, type StudyResult } from "./types";

// ============================================================
// Moteur d'étude (P8) - couche de lecture centrale (section 3 du prompt).
// buildStudyContext() est LE seul point d'entrée pour lire les données
// nécessaires à une étude : personne d'autre ne doit relire Prisma pour ces
// besoins (scenarios.ts/recommendations.ts consomment uniquement ce
// contexte typé, jamais Prisma directement).
// ============================================================

// Seule fiche migrée dans le moteur réglementaire P7 à ce jour (section 5 :
// "il ne doit PAS inventer automatiquement des calculs réglementaires pour
// des fiches qui ne sont pas encore dans le moteur").
const FICHES_MIGREES: Partial<Record<string, string>> = {
  PAC_AIR_EAU: "BAR-TH-171",
};

function buildRegulatoryInputsForPoste(poste: {
  id: string;
  type: string;
  surfaceM2: number | null;
  calculReglementaireActif: { inputs: unknown } | null;
}, zoneClimatique: string | null): StudyRegulatoryInputs {
  const ficheCode = FICHES_MIGREES[poste.type] ?? null;
  if (!ficheCode) {
    return { posteId: poste.id, ficheCode: null, inputs: {}, missingFields: [] };
  }

  const missingFields: string[] = [];
  if (!zoneClimatique) missingFields.push("zoneClimatique");
  if (poste.surfaceM2 == null) missingFields.push("surfaceChauffeeM2");

  // etasBande n'est jamais stocké comme un champ dédié - on ne connaît sa
  // dernière valeur que via le dernier calcul réglementaire enregistré pour
  // ce poste (section 2 : donnée "estimée" reprise d'un calcul précédent,
  // jamais inventée si aucun calcul n'existe encore).
  const previousInputs = (poste.calculReglementaireActif?.inputs ?? null) as Record<string, unknown> | null;
  const etasBande = (previousInputs?.etasBande as string | undefined) ?? null;
  if (!etasBande) missingFields.push("etasBande");

  return {
    posteId: poste.id,
    ficheCode,
    inputs: { zoneClimatique, surfaceChauffeeM2: poste.surfaceM2, etasBande },
    missingFields,
  };
}

function computeStudyDataQuality(params: {
  caConfidence: "HIGH" | "MEDIUM" | "LOW";
  costStatus: "COMPLETE" | "INCOMPLETE";
  hasEngagementDate: boolean;
  hasAnyPosteAvecFiche: boolean;
  regulatoryInputsAllComplete: boolean;
}): StudyDataQuality {
  if (params.caConfidence === "LOW") return "INSUFFICIENT";
  if (!params.hasEngagementDate) return "PARTIAL";
  if (params.hasAnyPosteAvecFiche && !params.regulatoryInputsAllComplete) return "PARTIAL";
  if (params.costStatus === "INCOMPLETE") return "GOOD";
  return "COMPLETE";
}

/**
 * Point d'entrée central de lecture des données nécessaires à une étude
 * (section 3 du prompt P8). N'exige AUCUNE donnée ANAH/workflow pour
 * fonctionner (section 30 : pipeline commercial) - un dossier tout juste
 * créé produit un contexte valide, seulement avec beaucoup de champs
 * ABSENT et une dataQuality basse.
 */
export async function buildStudyContext(dossierId: string, organisationId: string): Promise<StudyContext> {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    include: {
      client: true,
      postesTravaux: { include: { calculReglementaireActif: { select: { inputs: true } } } },
    },
  });
  if (!dossier) throw new Error("Dossier introuvable.");

  const [ca, couts, entrees] = await Promise.all([
    calculateContractualRevenue(dossierId),
    calculateForecastCosts(dossierId),
    calculateEntrees(dossierId),
  ]);

  const costStatus: "COMPLETE" | "INCOMPLETE" = couts.details.length === 0 ? "INCOMPLETE" : "COMPLETE";

  const financial = {
    caContractuelCts: ca.amountCts,
    caSource: ca.source,
    caConfidence: ca.confidence,
    coutsPrevusCts: couts.totalCts,
    costStatus,
    coutsLimites: couts.limites,
    aideMprConnueCts: dossier.montantAideMPR,
    aideCeeConnueCts: dossier.montantAideCEE,
    encaisseCts: entrees.encaisseCts,
    resteAEncaisserCts: entrees.resteAEncaisserCts,
  };

  const zoneClimatique = dossier.client.zoneClimatique;

  const regulatoryInputs = dossier.postesTravaux.map((p) => buildRegulatoryInputsForPoste(p, zoneClimatique));

  const project = {
    postes: dossier.postesTravaux.map((p) => ({
      posteId: p.id,
      typeTravaux: p.type,
      surfaceM2: qualified.connu(p.surfaceM2),
      etasBande: qualified.connu(
        (regulatoryInputs.find((r) => r.posteId === p.id)?.inputs.etasBande as "111a140" | "plus140" | undefined) ?? null
      ),
      puissance: qualified.absent<number>(),
      coutHTCts: qualified.connu(p.montantMaterielHTCts),
      coutTTCCts: qualified.connu(p.montantMaterielTTCCts),
      ficheReglementaireCode: p.ficheReglementaireCode,
    })),
    dateEngagement: qualified.connu(dossier.dateSignatureDevis),
    delegataireCeeActuelId: dossier.delegataireCeeId,
    dateDepotDelegataireCee: qualified.connu(dossier.dateDepotDelegataireCee),
  };

  const client = {
    nom: dossier.client.nom,
    prenom: dossier.client.prenom,
    typeOccupant: qualified.absent<"PROPRIETAIRE" | "LOCATAIRE">(),
    precarite: qualified.connu(dossier.client.precarite),
    revenuMenage: qualified.absent<number>(),
    compositionMenage: qualified.absent<number>(),
  };

  const logement = {
    adresse: qualified.connu(dossier.client.adresse),
    typeBatiment: qualified.absent<"MAISON" | "APPARTEMENT">(),
    surfaceHabitableM2: qualified.connu(dossier.client.surfaceHabitableM2),
    anneeConstruction: qualified.connu(dossier.client.anneeConstruction),
    zoneClimatique: qualified.connu(dossier.client.zoneClimatique),
    chauffageExistant: qualified.absent<string>(),
    ecs: qualified.absent<string>(),
    nombreLogements: qualified.absent<number>(),
    dpe: qualified.absent<string>(),
  };

  const missingFields: string[] = [];
  if (financial.caConfidence === "LOW") missingFields.push("financial.caContractuel");
  if (!dossier.dateSignatureDevis) missingFields.push("project.dateEngagement");
  if (financial.costStatus === "INCOMPLETE") missingFields.push("financial.coutsPrevus");
  if (!zoneClimatique) missingFields.push("logement.zoneClimatique");
  for (const ri of regulatoryInputs) {
    for (const mf of ri.missingFields) missingFields.push(`poste:${ri.posteId}.${mf}`);
  }

  const hasAnyPosteAvecFiche = regulatoryInputs.some((r) => r.ficheCode !== null);
  const regulatoryInputsAllComplete = regulatoryInputs.filter((r) => r.ficheCode !== null).every((r) => r.missingFields.length === 0);

  const dataQuality = computeStudyDataQuality({
    caConfidence: financial.caConfidence,
    costStatus: financial.costStatus,
    hasEngagementDate: dossier.dateSignatureDevis !== null,
    hasAnyPosteAvecFiche,
    regulatoryInputsAllComplete,
  });

  return {
    organisationId,
    dossierId,
    dossierReference: dossier.reference,
    client,
    logement,
    project,
    financial,
    regulatoryInputs,
    dataQuality,
    missingFields,
    builtAt: new Date(),
  };
}

/**
 * Hash stable des données critiques ayant produit une étude (section 29) -
 * permet de détecter l'obsolescence (isStudyStale) sans dépendre d'un
 * timestamp : un dossier peut être modifié sans que rien de pertinent pour
 * l'étude ne change (ex. changement de statut administratif).
 */
export function computeStudyInputHash(context: StudyContext): string {
  const canonical = {
    caContractuelCts: context.financial.caContractuelCts,
    coutsPrevusCts: context.financial.coutsPrevusCts,
    aideMprConnueCts: context.financial.aideMprConnueCts,
    aideCeeConnueCts: context.financial.aideCeeConnueCts,
    dateEngagement: context.project.dateEngagement.value ? context.project.dateEngagement.value.toISOString() : null,
    delegataireCeeActuelId: context.project.delegataireCeeActuelId,
    dateDepotDelegataireCee: context.project.dateDepotDelegataireCee.value
      ? context.project.dateDepotDelegataireCee.value.toISOString()
      : null,
    zoneClimatique: context.logement.zoneClimatique.value,
    postes: [...context.project.postes]
      .sort((a, b) => a.posteId.localeCompare(b.posteId))
      .map((p) => ({
        posteId: p.posteId,
        typeTravaux: p.typeTravaux,
        surfaceM2: p.surfaceM2.value,
        etasBande: p.etasBande.value,
        coutTTCCts: p.coutTTCCts.value,
        ficheReglementaireCode: p.ficheReglementaireCode,
      })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Une étude enregistrée devient obsolète si les données critiques ont
 * changé depuis (section 28) - ne compare jamais un simple timestamp,
 * seulement le hash des données réellement utilisées par le calcul.
 * L'ancienne étude n'est jamais supprimée ni modifiée : on affiche
 * seulement "Étude à recalculer".
 */
export function isStudyStale(etude: { inputHash: string }, currentContext: StudyContext): boolean {
  return etude.inputHash !== computeStudyInputHash(currentContext);
}

/**
 * Fonction principale du moteur d'étude (section 1 du prompt P8). Calcul
 * pur, ne persiste rien : la sauvegarde d'une étude OFFICIEL (snapshot,
 * AuditLog) est un acte explicite séparé (Server Action), jamais un effet
 * de bord de ce calcul (section 20).
 */
export async function runDossierStudy(params: { organisationId: string; dossierId: string; mode: StudyMode }): Promise<StudyResult> {
  const context = await buildStudyContext(params.dossierId, params.organisationId);
  const rawScenarios = await generateStudyScenarios(context);
  const scenarios = scoreAndRecommendScenarios(rawScenarios, context.dataQuality);
  const { scenarioId, label } = pickRecommendedScenario(scenarios);

  return {
    mode: params.mode,
    context,
    scenarios,
    recommendedScenarioLabel: label,
    recommendedScenarioId: scenarioId,
    generatedAt: new Date(),
  };
}
