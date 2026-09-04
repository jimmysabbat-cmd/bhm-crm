import { noopAddressConnector, noopBuildingDataConnector, noopDpeConnector, noopCompanyConnector } from "./noop";
import type { AddressInput, ConnectorResult, NormalizedAddress, GeocodedAddress, BuildingData, DpeData } from "./types";

export * from "./types";

// Point d'entrée unique (section 27/28) - aujourd'hui câblé sur les
// implémentations "noop" (aucune API réelle). Remplacer ces exports par un
// vrai connecteur validé est le SEUL changement nécessaire pour brancher
// une source externe plus tard, sans toucher au reste du code appelant.
export function normalizeAddress(input: AddressInput): Promise<ConnectorResult<NormalizedAddress>> {
  return noopAddressConnector.normalizeAddress(input);
}

export function geocodeAddress(input: AddressInput): Promise<ConnectorResult<GeocodedAddress>> {
  return noopAddressConnector.geocodeAddress(input);
}

export function getBuildingData(input: AddressInput): Promise<ConnectorResult<BuildingData>> {
  return noopBuildingDataConnector.getBuildingData(input);
}

export function getDpeData(input: AddressInput): Promise<ConnectorResult<DpeData>> {
  return noopDpeConnector.getDpeData(input);
}

export const companyConnector = noopCompanyConnector;
