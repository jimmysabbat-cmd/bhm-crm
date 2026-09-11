import type { AddressInput, ConnectorResult, DpeConnector, DpeData } from "./types";

// ============================================================
// Connecteur DPE réel (P14, audit section M) - jeu de données ouvertes DPE
// de l'ADEME ("dpe-v2-logements-existants"), exposé via l'API data-fair
// data.ademe.fr. Documentation : https://data.ademe.fr/datasets/dpe-v2-logements-existants
//
// Non branché par défaut (src/lib/connectors/index.ts reste sur Noop tant
// qu'un admin ne bascule pas explicitement). Un résultat ADEME est
// TOUJOURS une proposition (confidence, jamais VERIFIE d'emblée) - c'est
// l'appelant (src/lib/connectors non concerné directement, cf. UI
// qualification) qui doit la faire transiter par ChampProvenance et exiger
// une confirmation humaine avant d'écraser Logement.dpe, exactement comme
// pour l'adresse. Supporte plusieurs candidats via getDpeCandidates -
// aucune correspondance par proximité n'est "LE bon DPE" par défaut
// (audit : "un DPE trouvé par proximité/adresse n'est pas automatiquement
// le bon DPE").
// ============================================================

// Identifiant du jeu de données vérifié le 2026-09-11 via
// https://data.ademe.fr/data-fair/api/v1/datasets?q=dpe%20logements%20existants
// ("DPE Logements existants (depuis juillet 2021)") - à re-vérifier via
// cette même recherche si ce endpoint venait à répondre 404 (l'identifiant
// data-fair n'est pas garanti immuable à très long terme).
const ADEME_DATASET_ID = "meg-83tjwtg8dyz4vv7h1dqe";
const ADEME_BASE_URL = `https://data.ademe.fr/data-fair/api/v1/datasets/${ADEME_DATASET_ID}/lines`;
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timeout);
  }
}

// Champs du dataset ADEME réellement mappés vers DpeData - noms de colonnes
// tels que documentés sur data.ademe.fr pour dpe-v2-logements-existants.
type AdemeRecord = {
  numero_dpe?: string;
  etiquette_dpe?: string;
  etiquette_ges?: string;
  conso_5_usages_par_m2_ep?: number;
  surface_habitable_logement?: number;
  annee_construction?: number;
  type_batiment?: string;
  type_energie_principale_chauffage?: string;
  type_installation_chauffage?: string;
  type_energie_principale_ecs?: string;
  date_etablissement_dpe?: string;
  code_postal_ban?: string;
  nom_commune_ban?: string;
  score_ban?: number;
};

type AdemeSearchResponse = {
  total: number;
  results: AdemeRecord[];
};

function toTypeBatiment(raw: string | undefined): "MAISON" | "APPARTEMENT" | null {
  if (!raw) return null;
  const normalized = raw.toUpperCase();
  if (normalized.includes("MAISON")) return "MAISON";
  if (normalized.includes("APPARTEMENT")) return "APPARTEMENT";
  return null;
}

function mapRecordToDpeData(record: AdemeRecord): DpeData {
  return {
    etiquette: record.etiquette_dpe ?? null,
    etiquetteGES: record.etiquette_ges ?? null,
    consommationAnnuelleKwh:
      record.conso_5_usages_par_m2_ep != null && record.surface_habitable_logement != null
        ? Math.round(record.conso_5_usages_par_m2_ep * record.surface_habitable_logement)
        : null,
    surfaceHabitableM2: record.surface_habitable_logement ?? null,
    anneeConstruction: record.annee_construction ?? null,
    typeBatiment: toTypeBatiment(record.type_batiment),
    energieChauffage: record.type_energie_principale_chauffage ?? null,
    typeInstallationChauffage: record.type_installation_chauffage ?? null,
    typeEnergieEcs: record.type_energie_principale_ecs ?? null,
    dateEtablissementDpe: record.date_etablissement_dpe ?? null,
    numeroDpe: record.numero_dpe ?? null,
  };
}

async function search(input: AddressInput, size: number): Promise<ConnectorResult<AdemeSearchResponse>> {
  const q = [input.adresse, input.codePostal, input.ville].filter(Boolean).join(" ");
  if (!q.trim()) return { ok: false, reason: "Adresse vide - impossible d'interroger le jeu de données DPE." };

  try {
    const url = `${ADEME_BASE_URL}?q=${encodeURIComponent(q)}&size=${size}&sort=-date_etablissement_dpe`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, reason: `Service DPE ADEME indisponible (HTTP ${response.status}) - saisie manuelle requise.` };
    }
    const data = (await response.json()) as AdemeSearchResponse;
    if (!data.results || data.results.length === 0) {
      return { ok: false, reason: "Aucun DPE trouvé pour cette adresse - saisie manuelle requise." };
    }
    // Le score de correspondance d'adresse (score_ban) pilote la confiance -
    // jamais une confiance HIGH par défaut pour une correspondance
    // approximative (audit : "un DPE trouvé par proximité n'est pas
    // automatiquement le bon DPE").
    const bestScore = data.results[0].score_ban ?? 0;
    return {
      ok: true,
      data,
      source: "data.ademe.fr (DPE v2 logements existants)",
      fetchedAt: new Date(),
      confidence: bestScore >= 0.8 ? "MEDIUM" : "LOW",
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "Délai dépassé (timeout) - saisie manuelle requise." : "Erreur réseau - saisie manuelle requise.";
    return { ok: false, reason };
  }
}

export const ademeDpeConnector: DpeConnector = {
  async getDpeData(input: AddressInput): Promise<ConnectorResult<DpeData>> {
    const result = await search(input, 1);
    if (!result.ok) return result;
    const record = result.data.results[0];
    return {
      ok: true,
      data: mapRecordToDpeData(record),
      source: result.source,
      fetchedAt: result.fetchedAt,
      confidence: result.confidence,
      rawReference: record.numero_dpe ?? undefined,
    };
  },
};

/**
 * Plusieurs candidats DPE pour une même adresse (audit : "supporter
 * plusieurs candidats") - un logement peut avoir plusieurs DPE établis à
 * des dates différentes ; ne jamais prétendre que le premier résultat est
 * automatiquement le bon sans confirmation humaine.
 */
export async function getDpeCandidates(input: AddressInput, limit = 5): Promise<ConnectorResult<DpeData[]>> {
  const result = await search(input, limit);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.results.map(mapRecordToDpeData),
    source: result.source,
    fetchedAt: result.fetchedAt,
    confidence: result.confidence,
  };
}
