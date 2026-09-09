"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requirePlatformContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { assertUsableAsPrincipalAdmin } from "@/lib/platform/tenant-users";
import type { Role } from "@/generated/prisma/enums";

// ============================================================
// Actions plateforme de gestion des accès/utilisateurs d'un tenant (P13,
// audit SaaS section A) - toutes réservées au PLATFORM SUPER ADMIN via
// requirePlatformContext() (jamais Role.ADMIN), toujours avec un
// organisationId EXPLICITE vérifié à chaque mutation (jamais un id
// utilisateur seul sans vérifier son organisationId - même principe que
// src/app/parametrage/actions.ts, appliqué ici au niveau plateforme).
// Réutilise exclusivement les mécanismes existants (bcrypt, invitations,
// password reset) - jamais un second système d'authentification. Aucun
// mot de passe ni hash n'est jamais loggé.
// ============================================================

async function loadOrgScopedUser(userId: string, organisationId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, organisationId }, select: { id: true } });
  if (!user) throw new Error("Utilisateur introuvable dans cette organisation.");
  return user;
}

export async function setPrincipalAdminAction(organisationId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    await assertUsableAsPrincipalAdmin(organisationId, userId);

    await prisma.organisation.update({ where: { id: organisationId }, data: { principalAdminUserId: userId } });
    await logAudit({ organisationId, userId: platform.userId, entityType: "Organisation", entityId: organisationId, action: "PLATFORM_ADMIN_PRINCIPAL_DEFINI", metadata: { principalAdminUserId: userId } });

    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function platformCreateUserAction(organisationId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const role = formData.get("role") as Role;
    if (!name || !email || !password || password.length < 8) {
      throw new Error("Nom, email et mot de passe (8 caractères min) requis.");
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error("Un compte existe déjà avec cet email.");

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hashed, role, organisationId } });

    await logAudit({ organisationId, userId: platform.userId, entityType: "User", entityId: user.id, action: "PLATFORM_UTILISATEUR_CREE", metadata: { email, role } });
    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function platformInviteUserAction(organisationId: string, formData: FormData): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const role = formData.get("role") as Role;
    if (!email || !role) throw new Error("Email et rôle requis.");

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error("Un compte existe déjà avec cet email.");

    const { createInvitation } = await import("@/lib/invitations/service");
    const token = await createInvitation({ organisationId, email, role, invitedById: platform.userId });
    const appUrl = process.env.APP_URL || "http://localhost:3000";

    await logAudit({ organisationId, userId: platform.userId, entityType: "UserInvitation", entityId: email, action: "PLATFORM_INVITATION_ENVOYEE", metadata: { email, role } });
    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true, link: `${appUrl}/invitations/${token}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Régénère une invitation (lien expiré/perdu) - crée une NOUVELLE invitation, ne modifie jamais l'ancienne (historique conservé, cf. UserInvitation). */
export async function platformRegenerateInvitationAction(organisationId: string, invitationId: string): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    const old = await prisma.userInvitation.findFirst({ where: { id: invitationId, organisationId } });
    if (!old) throw new Error("Invitation introuvable dans cette organisation.");

    const existingUser = await prisma.user.findUnique({ where: { email: old.email }, select: { id: true } });
    if (existingUser) throw new Error("Un compte existe déjà avec cet email - l'invitation n'est plus nécessaire.");

    const { createInvitation } = await import("@/lib/invitations/service");
    const token = await createInvitation({ organisationId, email: old.email, role: old.role, invitedById: platform.userId });
    const appUrl = process.env.APP_URL || "http://localhost:3000";

    await logAudit({ organisationId, userId: platform.userId, entityType: "UserInvitation", entityId: old.email, action: "PLATFORM_INVITATION_REGENEREE", metadata: { email: old.email, role: old.role } });
    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true, link: `${appUrl}/invitations/${token}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function platformToggleUserActifAction(organisationId: string, userId: string, actif: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    await loadOrgScopedUser(userId, organisationId);

    await prisma.user.update({ where: { id: userId }, data: { actif } });
    await logAudit({ organisationId, userId: platform.userId, entityType: "User", entityId: userId, action: actif ? "PLATFORM_UTILISATEUR_REACTIVE" : "PLATFORM_UTILISATEUR_SUSPENDU" });
    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function platformUpdateUserRoleAction(organisationId: string, userId: string, role: Role): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    await loadOrgScopedUser(userId, organisationId);

    await prisma.user.update({ where: { id: userId }, data: { role } });
    await logAudit({ organisationId, userId: platform.userId, entityType: "User", entityId: userId, action: "PLATFORM_UTILISATEUR_ROLE_MODIFIE", metadata: { role } });
    revalidatePath(`/platform/organisations/${organisationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function platformGeneratePasswordResetLinkAction(organisationId: string, userId: string): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    await requirePlatformContext();
    await loadOrgScopedUser(userId, organisationId);

    const { createPasswordResetToken } = await import("@/lib/invitations/service");
    const token = await createPasswordResetToken(userId);
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    return { ok: true, link: `${appUrl}/reinitialiser/${token}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
