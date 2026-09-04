import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { getRateLimiter, RATE_LIMITS } from "@/lib/rate-limit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // P12 (section 27/33) - rate limiting par email, jamais un message
        // d'erreur distinguant "compte inconnu" de "mot de passe incorrect"
        // (return null dans les deux cas, comme déjà le cas ci-dessous).
        const allowed = await getRateLimiter().check(`login:${email.toLowerCase()}`, RATE_LIMITS.LOGIN.limit, RATE_LIMITS.LOGIN.windowMs);
        if (!allowed) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.actif) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, role: user.role, isPlatformSuperAdmin: user.isPlatformSuperAdmin };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
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
});
