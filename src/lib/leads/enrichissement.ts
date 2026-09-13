import { prisma } from "@/lib/prisma";
import { normalizeAddress, geocodeAddress, getDpeCandidates } from "@/lib/connectors";
import type { DpeData } from "@/lib/connectors/types";
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

// P14.1 - traduction UNIQUE (un seul endroit à lire) du niveau LOW/MEDIUM/HIGH
// retourné par un connecteur vers l'enum Prisma NiveauConfianceProposition.
// Jamais dupliquée ailleurs.
const CONFIANCE_CONNECTEUR_VERS_PROPOSITION: Record<"LOW" | "MEDIUM" | "HIGH", "FAIBLE" | "MOYENNE" | "ELEVEE"> = {
  LOW: "FAIBLE",
  MEDIUM: "MOYENNE",
  HIGH: "ELEVEE",
};

export type EnrichissementResult = {
  logementId: string;
  propositions: ChampPropose[];
  erreurs: string[];
  /** P14.2 (audit section 6) - plusieurs DPE plausibles trouvés pour cette
   * adresse : aucun n'est proposé automatiquement, le télépro doit choisir
   * explicitement via proposerChampsDpeChoisi(). Vide sinon (0 ou 1
   * candidat -> déjà traité automatiquement ci-dessus). */
  dpeCandidatsAConfirmer: DpeData[];
};

/** Persiste une liste de champs proposés comme PROPOSITIONS en attente sur
 * ChampProvenance (jamais une écriture directe sur Logement). Ne touche
 * jamais un champ déjà VÉRIFIÉ humainement. Réutilisée par l'enrichissement
 * automatique adresse/DPE ET par le choix explicite d'un candidat DPE
 * (section 5/6) - un seul endroit qui sait écrire une proposition. */
async function persisterPropositions(params: { organisationId: string; logementId: string; propositions: ChampPropose[] }): Promise<void> {
  for (const p of params.propositions) {
    const existing = await prisma.champProvenance.findUnique({ where: { logementId_champ: { logementId: params.logementId, champ: p.champ } } });
    if (existing?.confiance === "VERIFIE") continue;

    const confianceProposee = CONFIANCE_CONNECTEUR_VERS_PROPOSITION[p.confiance];

    await prisma.champProvenance.upsert({
      where: { logementId_champ: { logementId: params.logementId, champ: p.champ } },
      update: {
        valeurProposee: p.valeur,
        sourceProposee: "API",
        confianceProposee,
        referenceExterne: p.referenceExterne ?? null,
        recupereeAt: new Date(),
        refuseeAt: null,
      },
      create: {
        organisationId: params.organisationId,
        logementId: params.logementId,
        champ: p.champ,
        source: "CLIENT",
        confiance: "DECLARE",
        valeurProposee: p.valeur,
        sourceProposee: "API",
        confianceProposee,
        referenceExterne: p.referenceExterne ?? null,
        recupereeAt: new Date(),
      },
    });
  }
}

function dpeChampsPropose(dpe: DpeData, source: string, confiance: "LOW" | "MEDIUM" | "HIGH"): ChampPropose[] {
  const out: ChampPropose[] = [];
  if (dpe.etiquette) out.push({ champ: "dpe", valeur: dpe.etiquette, source, confiance, referenceExterne: dpe.numeroDpe ?? undefined });
  if (dpe.surfaceHabitableM2 != null) out.push({ champ: "surfaceHabitableM2", valeur: String(dpe.surfaceHabitableM2), source, confiance, referenceExterne: dpe.numeroDpe ?? undefined });
  if (dpe.anneeConstruction != null) out.push({ champ: "anneeConstruction", valeur: String(dpe.anneeConstruction), source, confiance, referenceExterne: dpe.numeroDpe ?? undefined });
  if (dpe.typeBatiment) out.push({ champ: "typeBatiment", valeur: dpe.typeBatiment, source, confiance, referenceExterne: dpe.numeroDpe ?? undefined });
  return out;
}

/**
 * Lance les connecteurs adresse + DPE pour un lead et enregistre toute
 * donnée trouvée comme proposition en attente (jamais une écriture
 * directe). Idempotent : peut être rappelé (ex. adresse corrigée) sans
 * dupliquer de lignes (upsert par (logementId, champ)).
 *
 * DPE (audit section 6) : si plusieurs candidats plausibles existent pour
 * cette adresse, AUCUN n'est proposé automatiquement - ils sont retournés
 * dans dpeCandidatsAConfirmer pour sélection explicite humaine (jamais un
 * choix silencieux du "premier résultat").
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
  const [normalise, geocode, dpe] = await Promise.all([normalizeAddress(input), geocodeAddress(input), getDpeCandidates(input, 5)]);

  const propositions: ChampPropose[] = [];
  const erreurs: string[] = [];
  let dpeCandidatsAConfirmer: DpeData[] = [];

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
    if (dpe.data.length === 1) {
      propositions.push(...dpeChampsPropose(dpe.data[0], dpe.source, dpe.confidence));
    } else if (dpe.data.length > 1) {
      dpeCandidatsAConfirmer = dpe.data;
    }
  } else {
    erreurs.push(`DPE : ${dpe.reason}`);
  }

  await persisterPropositions({ organisationId: params.organisationId, logementId: logement.id, propositions });

  return { logementId: logement.id, propositions, erreurs, dpeCandidatsAConfirmer };
}

/**
 * Choix EXPLICITE d'un candidat DPE parmi plusieurs (audit section 6) -
 * jamais un choix silencieux du premier résultat. Persiste ce candidat
 * exactement comme un enrichissement automatique à un seul résultat
 * (propositions en attente, jamais une écriture directe).
 */
export async function proposerChampsDpeChoisi(params: { organisationId: string; leadId: string; dpe: DpeData; source: string; confiance: "LOW" | "MEDIUM" | "HIGH" }): Promise<void> {
  const logement = await prisma.logement.upsert({
    where: { leadId: params.leadId },
    update: {},
    create: { organisationId: params.organisationId, leadId: params.leadId },
  });
  const propositions = dpeChampsPropose(params.dpe, params.source, params.confiance);
  await persisterPropositions({ organisationId: params.organisationId, logementId: logement.id, propositions });
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
      data: { valeurProposee: null, sourceProposee: null, confianceProposee: null, referenceExterne: null, refuseeAt: new Date() },
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
        confianceProposee: null,
      },
    }),
  ]);
}

/**
 * Confirmation GROUPÉE de plusieurs propositions en une seule action (audit
 * section 5 : "ne pas obliger le télépro à confirmer champ par champ si
 * plusieurs champs proviennent clairement du même résultat DPE"). Réutilise
 * EXACTEMENT reconcilierPropositionChamp par champ - la provenance reste
 * donc conservée individuellement par champ, seule l'action UI est groupée.
 * Une ligne déjà VÉRIFIÉE ou introuvable est simplement ignorée (jamais une
 * erreur bloquante pour le reste du lot).
 */
export async function reconcilierPlusieursPropositions(params: {
  organisationId: string;
  champProvenanceIds: string[];
  acceptedByUserId: string;
}): Promise<{ accepted: number }> {
  let accepted = 0;
  for (const id of params.champProvenanceIds) {
    try {
      await reconcilierPropositionChamp({ organisationId: params.organisationId, champProvenanceId: id, decision: "ACCEPTER", acceptedByUserId: params.acceptedByUserId });
      accepted += 1;
    } catch {
      // Ignore silencieusement une ligne déjà traitée entre-temps - jamais
      // bloquant pour le reste du lot groupé.
    }
  }
  return { accepted };
}
