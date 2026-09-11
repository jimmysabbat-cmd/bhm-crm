import { noopBuildingDataConnector, noopCompanyConnector } from "./noop";
import { geopfAddressConnector } from "./address-geopf";
import { ademeDpeConnector } from "./dpe-ademe";
import type { AddressInput, ConnectorResult, NormalizedAddress, GeocodedAddress, BuildingData, DpeData } from "./types";

export * from "./types";

// Point d'entrée unique (section 27/28) - AddressConnector/DpeConnector
// sont désormais branchés sur des sources réelles (P14, audit sections
// L/M : Géoplateforme IGN pour l'adresse, données ouvertes DPE ADEME).
// BuildingDataConnector reste Noop (aucune source publique exploitable
// identifiée/vérifiée dans cette phase - audit section N, ne bloque pas
// P14). Chaque connecteur réel retourne systématiquement { ok: false }
// (jamais d'exception) en cas de timeout/indisponibilité/absence de
// résultat - le CRM continue de fonctionner manuellement dans tous les cas.
export function normalizeAddress(input: AddressInput): Promise<ConnectorResult<NormalizedAddress>> {
  return geopfAddressConnector.normalizeAddress(input);
}

export function geocodeAddress(input: AddressInput): Promise<ConnectorResult<GeocodedAddress>> {
  return geopfAddressConnector.geocodeAddress(input);
}

export function getBuildingData(input: AddressInput): Promise<ConnectorResult<BuildingData>> {
  return noopBuildingDataConnector.getBuildingData(input);
}

export function getDpeData(input: AddressInput): Promise<ConnectorResult<DpeData>> {
  return ademeDpeConnector.getDpeData(input);
}

export const companyConnector = noopCompanyConnector;
