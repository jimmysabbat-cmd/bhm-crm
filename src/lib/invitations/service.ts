import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

// ============================================================
// Invitations & réinitialisation de mot de passe (P12, sections 28/29/55/
// 56) - tokens ALÉATOIRES cryptographiquement (32 octets), jamais stockés
// en clair (seul le hash SHA-256 est en base), expiration + usage unique
// systématiques. Aucun envoi email réel requis : le lien complet (avec le
// token EN CLAIR, jamais récupérable ensuite) est retourné une seule fois
// à l'appelant pour transmission manuelle.
// ============================================================

const INVITATION_TTL_MS = 7 * 24 * 3_600_000; // 7 jours
const RESET_TTL_MS = 2 * 3_600_000; // 2 heures - plus court, action sensible

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createInvitation(params: { organisationId: string; email: string; role: Role; invitedById: string }): Promise<string> {
  const raw = generateRawToken();
  await prisma.userInvitation.create({
    data: {
      organisationId: params.organisationId,
      email: params.email.trim().toLowerCase(),
      role: params.role,
      tokenHash: hashToken(raw),
      invitedById: params.invitedById,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  return raw;
}

export type InvitationCheck =
  | { valid: true; email: string; role: Role; organisationId: string; organisationNom: string }
  | { valid: false; reason: "NOT_FOUND" | "EXPIRED" | "USED" };

export async function checkInvitation(rawToken: string): Promise<InvitationCheck> {
  const invitation = await prisma.userInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { organisation: { select: { nom: true } } },
  });
  if (!invitation) return { valid: false, reason: "NOT_FOUND" };
  if (invitation.usedAt) return { valid: false, reason: "USED" };
  if (invitation.expiresAt < new Date()) return { valid: false, reason: "EXPIRED" };
  return { valid: true, email: invitation.email, role: invitation.role, organisationId: invitation.organisationId, organisationNom: invitation.organisation.nom };
}

export async function acceptInvitation(rawToken: string, name: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = await checkInvitation(rawToken);
  if (!check.valid) return { ok: false, error: "Invitation invalide, déjà utilisée ou expirée." };
  if (!name.trim()) return { ok: false, error: "Nom requis." };
  if (password.length < 8) return { ok: false, error: "Mot de passe : 8 caractères minimum." };

  const existing = await prisma.user.findUnique({ where: { email: check.email } });
  if (existing) return { ok: false, error: "Un compte existe déjà avec cet email." };

  const hashed = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.create({ data: { name: name.trim(), email: check.email, password: hashed, role: check.role, organisationId: check.organisationId, actif: true } }),
    prisma.userInvitation.update({ where: { tokenHash: hashToken(rawToken) }, data: { usedAt: new Date() } }),
  ]);
  return { ok: true };
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const raw = generateRawToken();
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
  return raw;
}

export async function checkResetToken(rawToken: string): Promise<boolean> {
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  return !!resetToken && !resetToken.usedAt && resetToken.expiresAt >= new Date();
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 8) return { ok: false, error: "Mot de passe : 8 caractères minimum." };
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { ok: false, error: "Lien invalide, déjà utilisé ou expiré." };
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { tokenHash: hashToken(rawToken) }, data: { usedAt: new Date() } }),
  ]);
  return { ok: true };
}
