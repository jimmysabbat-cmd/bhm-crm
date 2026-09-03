import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

// Rappel (cf. doc Next.js locale sur proxy.js) : le garde d'accès au niveau
// routeur ne couvre pas forcément chaque Server Function si son point
// d'entrée change - chaque Server Action doit donc vérifier sa propre
// session, indépendamment de src/proxy.ts.
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Non autorisé : session requise.");
  }
  return session;
}

export type UserContext = {
  userId: string;
  organisationId: string;
  role: Role;
};

// Contexte utilisateur fiable pour toute requête métier scoping par
// organisation : userId, organisationId et role sont toujours dérivés
// côté serveur depuis la session + la base, jamais depuis une valeur
// fournie par le client (formulaire, argument d'action...). Toute nouvelle
// requête qui filtre par organisation doit passer par ce helper plutôt que
// de faire confiance à un organisationId reçu du client.
export async function requireUserContext(): Promise<UserContext> {
  const session = await requireAuth();
  const userId = (session.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Non autorisé : session invalide.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organisationId: true, role: true, actif: true },
  });
  if (!user || !user.actif) {
    throw new Error("Non autorisé : compte introuvable ou désactivé.");
  }

  return { userId, organisationId: user.organisationId, role: user.role };
}

// Vérifie qu'un dossier existe ET appartient à l'organisation donnée, avant
// toute lecture/écriture sur lui ou une entité qui en dépend (tâche,
// document, poste de travaux...). Ne jamais se contenter d'un
// findUnique({ id }) seul sur un identifiant fourni par le client : ça
// permettrait d'agir sur un dossier d'une autre organisation.
export async function assertDossierInOrg(dossierId: string, organisationId: string): Promise<void> {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    select: { id: true },
  });
  if (!dossier) {
    throw new Error("Dossier introuvable.");
  }
}
