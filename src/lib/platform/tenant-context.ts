import { cookies } from "next/headers";

// ============================================================
// Contexte tenant actif pour le PLATFORM SUPER ADMIN (P12, sections 17/18).
// Un cookie simple (pas de secret à protéger : sa seule autorité vient du
// fait que requireUserContext() ne le lit QUE si le compte est
// isPlatformSuperAdmin - vérifié fraîchement en base à chaque requête,
// jamais fourni par le client). Un utilisateur tenant normal ignore
// totalement ce cookie (son organisationId vient toujours de sa propre
// ligne User, jamais du cookie).
// ============================================================

const COOKIE_NAME = "bhm_active_tenant_id";

export async function getActiveTenantIdCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function setActiveTenantIdCookie(organisationId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, organisationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Pas d'expiration longue : une session platform admin "entrée" dans
    // un tenant ne doit pas rester active indéfiniment après fermeture du
    // navigateur.
    maxAge: 60 * 60 * 12,
  });
}

export async function clearActiveTenantIdCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
