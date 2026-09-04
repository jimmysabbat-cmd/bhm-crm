// ============================================================
// Architecture de connecteurs d'enrichissement externe (P9, section 26).
// Prépare l'interface SANS brancher aucune API réelle - aucun scraping,
// aucun appel réseau non vérifié (section 28). Tant qu'aucun connecteur
// concret n'est configuré, le CRM continue de fonctionner entièrement
// manuellement (section 27) : le NoopConnector par défaut renvoie
// systématiquement `ok: false`.
// ============================================================

export type ConnectorConfidence = "LOW" | "MEDIUM" | "HIGH";

export type ConnectorResult<T> =
  | { ok: true; data: T; source: string; fetchedAt: Date; confidence: ConnectorConfidence; rawReference?: string }
  | { ok: false; reason: string };

export type AddressInput = { adresse: string; codePostal?: string | null; ville?: string | null };

export type NormalizedAddress = {
  adresse: string;
  codePostal: string | null;
  ville: string | null;
};

export type GeocodedAddress = {
  latitude: number;
  longitude: number;
};

export interface AddressConnector {
  normalizeAddress(input: AddressInput): Promise<ConnectorResult<NormalizedAddress>>;
  geocodeAddress(input: AddressInput): Promise<ConnectorResult<GeocodedAddress>>;
}

export type BuildingData = {
  anneeConstruction: number | null;
  surfaceHabitableM2: number | null;
  typeBatiment: "MAISON" | "APPARTEMENT" | null;
};

export interface BuildingDataConnector {
  getBuildingData(input: AddressInput): Promise<ConnectorResult<BuildingData>>;
}

export type DpeData = {
  etiquette: string | null;
  consommationAnnuelleKwh: number | null;
};

export interface DpeConnector {
  getDpeData(input: AddressInput): Promise<ConnectorResult<DpeData>>;
}

export type CompanyData = {
  raisonSociale: string | null;
  siret: string | null;
};

export interface CompanyConnector {
  getCompanyData(input: { siret?: string; raisonSociale?: string }): Promise<ConnectorResult<CompanyData>>;
}
