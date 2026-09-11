import { prisma } from "@/lib/prisma";
import { normalizeAddress, geocodeAddress, getDpeData } from "@/lib/connectors";
import type { Prisma } from "@/generated/prisma/client";

// ============================================================
// Enrichissement automatique par adresse (P14, audit section 2/8/L/M) -
// orchestre les connecteurs (adresse + DPE) et enregistre chaque résultat
// comme PROPOSITION en attente sur ChampProvenance, jamais directement sur
// Logement. Une donnée déjà confirmée (confiance VERIFIE) n'est JAMAIS
// écrasée, même par une nouvelle proposition - elle reste protégée tant
// qu'un humain n'a pas explicitement réconcilié la divergence.
// ============================================================

// Coercition typée champ par champ pour les seuls champs que CES
// connecteurs peuvent produire - volontairement distinct de la whitelist
// du questionnaire (src/lib/questionnaire/mapping.ts), qui couvre un
// périmètre plus large de champs saisis manuellement.
const LOGEMENT_FIELD_TYPE: Record<string, "string" | "float" | "int" | "enum"> = {
  adresse: "string",
  codePostal: "string",
  ville: "string",
  latitude: "float",
  longitude: "float",
  dpe: "string",
  surfaceHabitableM2: "float",
  anneeConstruction: "int",
  typeBatiment: "enum",
};

type ChampPropose = { champ: string; valeur: string; source: string; confiance: "LOW" | "MEDIUM" | "HIGH"; referenceExterne?: string };

export type EnrichissementResult = {
  logementId: string;
  propositions: ChampPropose[];
  erreurs: string[];
};

/**
 * Lance les connecteurs adresse + DPE pour un lead et enregistre toute
 * donnée trouvée comme proposition en attente (jamais une écriture
 * directe). Idempotent : peut être rappelé (ex. adresse corrigée) sans
 * dupliquer de lignes (upsert par (logementId, champ)).
 */
export async function proposerEnrichissementAdresse(params: {
  organisationId: string;
  leadId: string;
  adresse: string;
  codePostal?: string | null;
  ville?: string | null;
}): Promise<EnrichissementResult> {
  const logement = await prisma.logement.upsert({
    where: { leadId: params.leadId },
    update: {},
    create: { organisationId: params.organisationId, leadId: params.leadId },
  });

  const input = { adresse: params.adresse, codePostal: params.codePostal, ville: params.ville };
  const [normalise, geocode, dpe] = await Promise.all([normalizeAddress(input), geocodeAddress(input), getDpeData(input)]);

  const propositions: ChampPropose[] = [];
  const erreurs: string[] = [];

  if (normalise.ok) {
    propositions.push({ champ: "adresse", valeur: normalise.data.adresse, source: normalise.source, confiance: normalise.confidence });
    if (normalise.data.codePostal) propositions.push({ champ: "codePostal", valeur: normalise.data.codePostal, source: normalise.source, confiance: normalise.confidence });
    if (normalise.data.ville) propositions.push({ champ: "ville", valeur: normalise.data.ville, source: normalise.source, confiance: normalise.confidence });
  } else {
    erreurs.push(`Adresse : ${normalise.reason}`);
  }

  if (geocode.ok) {
    propositions.push({ champ: "latitude", valeur: String(geocode.data.latitude), source: geocode.source, confiance: geocode.confidence });
    propositions.push({ champ: "longitude", valeur: String(geocode.data.longitude), source: geocode.source, confiance: geocode.confidence });
  } else {
    erreurs.push(`Géocodage : ${geocode.reason}`);
  }

  if (dpe.ok) {
    if (dpe.data.etiquette) propositions.push({ champ: "dpe", valeur: dpe.data.etiquette, source: dpe.source, confiance: dpe.confidence, referenceExterne: dpe.rawReference });
    if (dpe.data.surfaceHabitableM2 != null) propositions.push({ champ: "surfaceHabitableM2", valeur: String(dpe.data.surfaceHabitableM2), source: dpe.source, confiance: dpe.confidence, referenceExterne: dpe.rawReference });
    if (dpe.data.anneeConstruction != null) propositions.push({ champ: "anneeConstruction", valeur: String(dpe.data.anneeConstruction), source: dpe.source, confiance: dpe.confidence, referenceExterne: dpe.rawReference });
    if (dpe.data.typeBatiment) propositions.push({ champ: "typeBatiment", valeur: dpe.data.typeBatiment, source: dpe.source, confiance: dpe.confidence, referenceExterne: dpe.rawReference });
  } else {
    erreurs.push(`DPE : ${dpe.reason}`);
  }

  for (const p of propositions) {
    const existing = await prisma.champProvenance.findUnique({ where: { logementId_champ: { logementId: logement.id, champ: p.champ } } });
    // Ne jamais toucher une donnée déjà VÉRIFIÉE humainement.
    if (existing?.confiance === "VERIFIE") continue;

    await prisma.champProvenance.upsert({
      where: { logementId_champ: { logementId: logement.id, champ: p.champ } },
      update: { valeurProposee: p.valeur, sourceProposee: "API", referenceExterne: p.referenceExterne ?? null, recupereeAt: new Date(), refuseeAt: null },
      create: {
        organisationId: params.organisationId,
        logementId: logement.id,
        champ: p.champ,
        source: "CLIENT",
        confiance: "DECLARE",
        valeurProposee: p.valeur,
        sourceProposee: "API",
        referenceExterne: p.referenceExterne ?? null,
        recupereeAt: new Date(),
      },
    });
  }

  return { logementId: logement.id, propositions, erreurs };
}

/**
 * Confirmation humaine d'une proposition en attente (audit : "aucune
 * écriture silencieuse"). ACCEPTER écrit la valeur dans le vrai champ
 * Logement et marque confiance VERIFIE (protégée définitivement contre un
 * futur écrasement silencieux). REFUSER efface simplement la proposition.
 */
export async function reconcilierPropositionChamp(params: {
  organisationId: string;
  champProvenanceId: string;
  decision: "ACCEPTER" | "REFUSER";
  valeurCorrigee?: string;
  acceptedByUserId: string;
}): Promise<void> {
  const cp = await prisma.champProvenance.findFirst({ where: { id: params.champProvenanceId, organisationId: params.organisationId } });
  if (!cp) throw new Error("Proposition introuvable.");

  if (params.decision === "REFUSER") {
    await prisma.champProvenance.update({
      where: { id: cp.id },
      data: { valeurProposee: null, sourceProposee: null, referenceExterne: null, refuseeAt: new Date() },
    });
    return;
  }

  const valeur = params.valeurCorrigee ?? cp.valeurProposee;
  if (valeur == null) throw new Error("Aucune valeur à accepter.");

  const kind = LOGEMENT_FIELD_TYPE[cp.champ];
  if (!kind) throw new Error(`Champ "${cp.champ}" non reconnu par l'enrichissement Logement.`);

  const data: Record<string, unknown> = {};
  if (kind === "float") data[cp.champ] = Number.parseFloat(valeur);
  else if (kind === "int") data[cp.champ] = Math.round(Number.parseFloat(valeur));
  else data[cp.champ] = valeur;

  await prisma.$transaction([
    prisma.logement.update({ where: { id: cp.logementId }, data: data as Prisma.LogementUpdateInput }),
    prisma.champProvenance.update({
      where: { id: cp.id },
      data: {
        confiance: "VERIFIE",
        source: cp.sourceProposee ?? cp.source,
        accepteeById: params.acceptedByUserId,
        accepteeAt: new Date(),
        valeurProposee: null,
        sourceProposee: null,
      },
    }),
  ]);
}
