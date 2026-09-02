import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next.js 16 a renommé middleware.ts en proxy.ts (comportement identique).
// On réutilise authConfig (sans provider, sans Prisma) pour ce garde d'accès
// global : toute page nécessite une session, sauf /login et les routes
// techniques NextAuth/Next exclues par le matcher ci-dessous. Les Server
// Actions passent par la même route que leur page et sont donc couvertes
// aussi - mais restent également protégées individuellement par
// requireAuth() côté serveur (défense en profondeur, cf. dossiers/actions.ts).
const { auth: proxy } = NextAuth(authConfig);

export default proxy;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
