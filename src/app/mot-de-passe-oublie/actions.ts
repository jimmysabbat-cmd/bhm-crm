"use server";

import { prisma } from "@/lib/prisma";
import { createPasswordResetToken } from "@/lib/invitations/service";
import { getRateLimiter, RATE_LIMITS } from "@/lib/rate-limit";

// P12 (section 27/56) - réponse TOUJOURS identique, que le compte existe
// ou non (jamais de fuite d'existence de compte). Le token est bien créé
// en base (utilisable via une future intégration email réelle sans
// refonte, cf. EmailProvider P11) mais n'est JAMAIS renvoyé à l'appelant
// anonyme ici - seul un admin authentifié peut obtenir un lien
// (adminGeneratePasswordResetLinkAction, /parametrage/equipe).
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  const allowed = await getRateLimiter().check(`reset:${email}`, RATE_LIMITS.PASSWORD_RESET_REQUEST.limit, RATE_LIMITS.PASSWORD_RESET_REQUEST.windowMs);
  if (!allowed) return;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, actif: true } });
  if (user && user.actif) {
    await createPasswordResetToken(user.id);
  }
}
