// ============================================================
// P16 - Construction des liens directs inclus dans les emails/
// notifications. Toujours une URL "normale" vers l'écran exact (jamais un
// token magique/lien de contournement) : l'accès reste vérifié
// intégralement côté serveur par la page cible elle-même (requireUserContext
// + isPartnerRole/canAccessXxx), un lien n'est qu'un raccourci - jamais un
// bypass. Un destinataire non connecté est redirigé vers /login puis vers
// l'URL demandée par le flux d'auth standard.
// ============================================================

function baseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function missionLinkForPartner(): string {
  return `${baseUrl()}/partenaire`;
}

export function dossierLinkForInternal(dossierId: string): string {
  return `${baseUrl()}/dossiers/${dossierId}`;
}

export function demandeLinkForDonneurOrdre(dossierId: string): string {
  return `${baseUrl()}/portail-do/${dossierId}`;
}

export function facturesLinkForDonneurOrdre(): string {
  return `${baseUrl()}/portail-do/factures`;
}

export function tachesLinkForInternal(): string {
  return `${baseUrl()}/taches`;
}

export function planningLinkForInternal(): string {
  return `${baseUrl()}/planning`;
}
