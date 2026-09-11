import type { AddressConnector, AddressInput, ConnectorResult, NormalizedAddress, GeocodedAddress } from "./types";

// ============================================================
// Connecteur adresse réel (P14, audit section L) - API de géocodage de la
// Géoplateforme IGN (data.geopf.fr), successeur officiel de l'ancienne API
// adresse.data.gouv.fr ("BAN") pour la recherche/géocodage d'adresses
// françaises. Documentation : https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
//
// IMPORTANT : ce fichier n'est PAS exécuté par défaut - src/lib/connectors/
// index.ts reste câblé sur les implémentations Noop tant qu'un admin ne
// bascule pas explicitement dessus (aucun appel réseau non validé
// n'est déclenché par le simple fait que ce fichier existe). Gère
// explicitement timeout / aucun résultat / plusieurs résultats / API
// indisponible - dans TOUS les cas d'échec, retourne { ok: false } pour
// que l'appelant continue manuellement (jamais d'exception non gérée).
// ============================================================

const GEOCODAGE_BASE_URL = "https://data.geopf.fr/geocodage";
const TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timeout);
  }
}

function buildQuery(input: AddressInput): string {
  const parts = [input.adresse, input.codePostal, input.ville].filter(Boolean);
  return parts.join(" ");
}

type GeopfFeature = {
  properties: {
    label: string;
    postcode: string | null;
    city: string | null;
    score: number;
  };
  geometry: {
    coordinates: [number, number]; // [longitude, latitude]
  };
};

type GeopfFeatureCollection = {
  features: GeopfFeature[];
};

async function search(input: AddressInput, limit: number): Promise<ConnectorResult<GeopfFeatureCollection>> {
  const q = buildQuery(input);
  if (!q.trim()) return { ok: false, reason: "Adresse vide - impossible d'interroger le géocodage." };

  try {
    const url = `${GEOCODAGE_BASE_URL}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, reason: `Service de géocodage indisponible (HTTP ${response.status}) - saisie manuelle requise.` };
    }
    const data = (await response.json()) as GeopfFeatureCollection;
    if (!data.features || data.features.length === 0) {
      return { ok: false, reason: "Aucune adresse correspondante trouvée - saisie manuelle requise." };
    }
    return {
      ok: true,
      data,
      source: "geopf.fr (Géoplateforme IGN)",
      fetchedAt: new Date(),
      confidence: data.features[0].properties.score >= 0.8 ? "HIGH" : data.features[0].properties.score >= 0.5 ? "MEDIUM" : "LOW",
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "Délai dépassé (timeout) - saisie manuelle requise." : "Erreur réseau - saisie manuelle requise.";
    return { ok: false, reason };
  }
}

export const geopfAddressConnector: AddressConnector = {
  async normalizeAddress(input: AddressInput): Promise<ConnectorResult<NormalizedAddress>> {
    const result = await search(input, 1);
    if (!result.ok) return result;

    // Plusieurs candidats possibles en amont (limit=1 ici, mais un futur
    // appelant voulant proposer un choix humain peut appeler search()
    // directement avec un limit plus élevé - cf. getAddressCandidates ci-
    // dessous) : on ne retient JAMAIS silencieusement le premier résultat
    // sans que son score de confiance soit reflété dans `confidence`.
    const best = result.data.features[0];
    return {
      ok: true,
      data: { adresse: best.properties.label, codePostal: best.properties.postcode, ville: best.properties.city },
      source: result.source,
      fetchedAt: result.fetchedAt,
      confidence: result.confidence,
      rawReference: JSON.stringify(best.properties),
    };
  },

  async geocodeAddress(input: AddressInput): Promise<ConnectorResult<GeocodedAddress>> {
    const result = await search(input, 1);
    if (!result.ok) return result;

    const best = result.data.features[0];
    const [longitude, latitude] = best.geometry.coordinates;
    return {
      ok: true,
      data: { latitude, longitude },
      source: result.source,
      fetchedAt: result.fetchedAt,
      confidence: result.confidence,
      rawReference: JSON.stringify(best.properties),
    };
  },
};

/**
 * Variante "plusieurs candidats" (audit : "gérer plusieurs résultats") -
 * pour une UI qui veut proposer un choix humain plutôt qu'accepter
 * silencieusement le meilleur score. Non branchée par défaut dans
 * AddressConnector (qui garde une signature à un seul résultat), utilisable
 * directement par un futur écran de sélection.
 */
export async function getAddressCandidates(input: AddressInput, limit = 5): Promise<ConnectorResult<NormalizedAddress[]>> {
  const result = await search(input, limit);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.features.map((f) => ({ adresse: f.properties.label, codePostal: f.properties.postcode, ville: f.properties.city })),
    source: result.source,
    fetchedAt: result.fetchedAt,
    confidence: result.confidence,
  };
}
