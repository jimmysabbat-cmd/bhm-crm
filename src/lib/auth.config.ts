import type { NextAuthConfig } from "next-auth";

// Config partagée avec le middleware (Edge runtime) - ne doit importer ni Prisma
// ni aucun module Node.js only.

// Espaces autorisés pour les comptes partenaires : tout le reste (dossiers,
// finances, leads, paramétrage...) est interne. La page d'accueil "/" reste
// accessible car elle redirige elle-même chaque rôle vers son espace.
const PARTNER_ALLOWED_PREFIXES: Record<string, string[]> = {
  DONNEUR_ORDRE: ["/portail-do", "/api/documents/", "/api/factures/"],
  SOUS_TRAITANT: ["/partenaire", "/api/documents/", "/api/factures/", "/api/transmission-packages/"],
  DELEGATAIRE_CEE: ["/partenaire", "/api/documents/", "/api/factures/", "/api/transmission-packages/"],
};
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const pathname = request.nextUrl.pathname;
      const isLoginPage = pathname === "/login";
      // P11 (section 17) : /api/internal/* a sa PROPRE protection par
      // secret serveur (AUTOMATIONS_INTERNAL_SECRET, vérifié dans la route
      // elle-même) - elle doit être appelable par un service externe SANS
      // session utilisateur (cron, service de ping), donc exclue ici du
      // garde de session. Ne jamais élargir ce préfixe sans une protection
      // équivalente dans chaque route concernée.
      const isInternalApi = pathname.startsWith("/api/internal/");
      if (isInternalApi) return true;

      // P12 (section 37) - health check public minimal, aucune donnée
      // sensible révélée (cf. la route elle-même).
      if (pathname === "/api/health") return true;

      // P12 (section 28/55/56) : les parcours invitation/réinitialisation
      // de mot de passe n'ont, par construction, PAS de session (l'invité
      // n'a pas encore de compte) - leur sécurité vient exclusivement du
      // token à usage unique/expirant vérifié côté serveur (jamais de
      // session requise ici).
      const isPublicAuthFlow =
        pathname === "/mot-de-passe-oublie" ||
        pathname.startsWith("/invitations/") ||
        pathname.startsWith("/reinitialiser/");
      if (isPublicAuthFlow) return true;

      if (!isLoggedIn && !isLoginPage) return false;
      if (isLoggedIn && isLoginPage) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      const role = (auth?.user as { role?: string } | undefined)?.role;
      const allowed = role ? PARTNER_ALLOWED_PREFIXES[role] : undefined;
      if (allowed && pathname !== "/" && !allowed.some((prefix) => pathname.startsWith(prefix))) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      return true;
    },
    // Rôle copié dans le JWT puis la session dès la config partagée, pour
    // que le proxy (Edge) puisse appliquer PARTNER_ALLOWED_PREFIXES.
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.isPlatformSuperAdmin = (user as { isPlatformSuperAdmin?: boolean }).isPlatformSuperAdmin ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.sub;
        (session.user as { isPlatformSuperAdmin?: boolean }).isPlatformSuperAdmin = Boolean(token.isPlatformSuperAdmin);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
