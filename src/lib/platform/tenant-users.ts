import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

// ============================================================
// Gestion des accès/utilisateurs d'un tenant DEPUIS le niveau plateforme
// (P13, audit SaaS section A) - toujours avec un organisationId EXPLICITE
// passé par l'appelant (jamais déduit d'un cookie "tenant entré"), à la
// différence de src/app/parametrage/actions.ts qui utilise
// ctx.organisationId (le tenant où l'ADMIN est connecté). Réutilise
// exclusivement les mécanismes P12 existants (bcrypt, invitations,
// password reset) - jamais un second système d'authentification.
// ============================================================

export type OrganisationAccessDetails = {
  organisation: {
    id: string;
    nom: string;
    slug: string;
    status: string;
    email: string | null;
    createdAt: Date;
    principalAdminUserId: string | null;
  };
  principalAdmin: { id: string; name: string; email: string; role: Role; actif: boolean; lastLoginAt: Date | null } | null;
  users: { id: string; name: string; email: string; role: Role; actif: boolean; createdAt: Date; lastLoginAt: Date | null; isPrincipalAdmin: boolean }[];
  pendingInvitations: { id: string; email: string; role: Role; expiresAt: Date; expired: boolean; createdAt: Date; invitedByName: string }[];
};

export async function getOrganisationAccessDetails(organisationId: string): Promise<OrganisationAccessDetails> {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true, nom: true, slug: true, status: true, email: true, createdAt: true, principalAdminUserId: true },
  });
  if (!organisation) throw new Error("Organisation introuvable.");

  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { organisationId },
      select: { id: true, name: true, email: true, role: true, actif: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userInvitation.findMany({
      where: { organisationId, usedAt: null },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const now = new Date();
  return {
    organisation,
    principalAdmin: organisation.principalAdminUserId ? (users.find((u) => u.id === organisation.principalAdminUserId) ?? null) : null,
    users: users.map((u) => ({ ...u, isPrincipalAdmin: u.id === organisation.principalAdminUserId })),
    pendingInvitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      expired: inv.expiresAt < now,
      createdAt: inv.createdAt,
      invitedByName: inv.invitedBy.name,
    })),
  };
}

/**
 * Contraintes métier du principal admin (audit SaaS section A) - vérifiées
 * ICI, jamais en base : l'utilisateur doit exister, appartenir à LA MÊME
 * organisation, avoir le rôle ADMIN, être actif, et n'être JAMAIS un
 * PLATFORM_SUPER_ADMIN (qui n'appartient structurellement à aucun tenant -
 * cf. src/lib/authz.ts).
 */
export async function assertUsableAsPrincipalAdmin(organisationId: string, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organisationId: true, role: true, actif: true, isPlatformSuperAdmin: true },
  });
  if (!user) throw new Error("Utilisateur introuvable.");
  if (user.isPlatformSuperAdmin) throw new Error("Un PLATFORM_SUPER_ADMIN ne peut jamais être désigné admin principal d'un tenant.");
  if (user.organisationId !== organisationId) throw new Error("Cet utilisateur n'appartient pas à cette organisation.");
  if (user.role !== "ADMIN") throw new Error("L'admin principal doit avoir le rôle ADMIN.");
  if (!user.actif) throw new Error("L'admin principal doit être un compte actif.");
}
