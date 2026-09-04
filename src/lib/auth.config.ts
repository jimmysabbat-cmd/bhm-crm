import type { NextAuthConfig } from "next-auth";

// Config partagée avec le middleware (Edge runtime) - ne doit importer ni Prisma
// ni aucun module Node.js only.
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
      return true;
    },
  },
} satisfies NextAuthConfig;
