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
      const isLoginPage = request.nextUrl.pathname === "/login";
      // P11 (section 17) : /api/internal/* a sa PROPRE protection par
      // secret serveur (AUTOMATIONS_INTERNAL_SECRET, vérifié dans la route
      // elle-même) - elle doit être appelable par un service externe SANS
      // session utilisateur (cron, service de ping), donc exclue ici du
      // garde de session. Ne jamais élargir ce préfixe sans une protection
      // équivalente dans chaque route concernée.
      const isInternalApi = request.nextUrl.pathname.startsWith("/api/internal/");
      if (isInternalApi) return true;

      if (!isLoggedIn && !isLoginPage) return false;
      if (isLoggedIn && isLoginPage) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
