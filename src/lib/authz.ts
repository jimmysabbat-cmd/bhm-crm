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

// --- Permissions (V1 simple, pas d'ABAC) ---
//
// hasRole/requireRole pour les vérifications ponctuelles par rôle ;
// hasPermission pour les règles métier nommées qui regroupent plusieurs
// rôles, centralisées ici plutôt que dispersées en `if (role === ...)`
// dans les pages/actions. Objectif V1 (section 19) : ADMIN a la vue
// globale, ADMINISTRATIF/COMMERCIAL/COMPTABILITE ont leurs domaines, les
// autres rôles restent préparés sans permission spécifique pour l'instant.

export function hasRole(ctx: UserContext, ...roles: Role[]): boolean {
  return roles.includes(ctx.role);
}

export function requireRole(ctx: UserContext, ...roles: Role[]): void {
  if (!hasRole(ctx, ...roles)) {
    throw new Error("Accès refusé pour ce rôle.");
  }
}

export type Permission =
  | "VIEW_ALL_ACTIONS"
  | "MANAGE_FINANCES"
  | "MANAGE_PROGRAMMES"
  | "MANAGE_EQUIPE"
  // P6 - moteur financier (section 26). ADMIN a toujours tout. COMPTABILITE
  // (+ COMPTA legacy) a la vue finance complète, y compris coûts internes et
  // marge. ADMINISTRATIF ne voit que ce qui est nécessaire aux encaissements
  // et aides (résumé financier), jamais la marge ni les coûts internes.
  // COMMERCIAL/REGIE/SOUS_TRAITANT/TECHNIQUE n'ont aucune de ces permissions
  // par défaut - "sauf permission explicite" (non implémentée en V1 : pas de
  // permissions par utilisateur, seulement par rôle).
  | "VIEW_FINANCIAL_SUMMARY"
  | "VIEW_INTERNAL_COSTS"
  | "VIEW_MARGIN"
  | "MANAGE_FINANCE"
  // P7 - moteur réglementaire (section 32). MANAGE_REGLEMENTATION couvre
  // publier une version, modifier un barème, modifier un tarif délégataire
  // et faire un override réglementaire - réservé à la direction. Les autres
  // rôles internes (hors REGIE/SOUS_TRAITANT, sans accès global finance/
  // réglementaire déjà en P6) peuvent simuler un calcul CEE sans rien
  // modifier de la réglementation.
  | "MANAGE_REGLEMENTATION"
  | "SIMULATE_REGLEMENTATION";

const PERMISSIONS: Record<Permission, Role[]> = {
  VIEW_ALL_ACTIONS: ["ADMIN"],
  MANAGE_FINANCES: ["ADMIN", "COMPTA", "COMPTABILITE"],
  MANAGE_PROGRAMMES: ["ADMIN"],
  MANAGE_EQUIPE: ["ADMIN"],
  VIEW_FINANCIAL_SUMMARY: ["ADMIN", "COMPTA", "COMPTABILITE", "ADMINISTRATIF"],
  VIEW_INTERNAL_COSTS: ["ADMIN", "COMPTA", "COMPTABILITE"],
  VIEW_MARGIN: ["ADMIN", "COMPTA", "COMPTABILITE"],
  MANAGE_FINANCE: ["ADMIN", "COMPTA", "COMPTABILITE"],
  MANAGE_REGLEMENTATION: ["ADMIN"],
  SIMULATE_REGLEMENTATION: ["ADMIN", "COMMERCIAL", "COMPTA", "COMPTABILITE", "ADMINISTRATIF", "TECHNIQUE"],
};

export function hasPermission(ctx: UserContext, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(ctx.role);
}
