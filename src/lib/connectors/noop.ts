import type {
  AddressConnector,
  BuildingDataConnector,
  DpeConnector,
  CompanyConnector,
  ConnectorResult,
} from "./types";

// Implémentation par défaut - AUCUN appel réseau, AUCUN scraping (sections
// 27/28). Utilisée tant qu'aucun connecteur réel n'a été validé et
// configuré : garantit que le CRM reste utilisable sans dépendance externe.
function notConfigured<T>(): Promise<ConnectorResult<T>> {
  return Promise.resolve({ ok: false, reason: "Aucun connecteur externe configuré - saisie manuelle requise." });
}

export const noopAddressConnector: AddressConnector = {
  normalizeAddress: () => notConfigured(),
  geocodeAddress: () => notConfigured(),
};

export const noopBuildingDataConnector: BuildingDataConnector = {
  getBuildingData: () => notConfigured(),
};

export const noopDpeConnector: DpeConnector = {
  getDpeData: () => notConfigured(),
};

export const noopCompanyConnector: CompanyConnector = {
  getCompanyData: () => notConfigured(),
};
