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
  // P11 - renseignés uniquement pour un compte partenaire (rôle
  // SOUS_TRAITANT/DELEGATAIRE_CEE) rattaché à son entité référentielle ;
  // absents/null pour tout compte interne. Optionnels pour ne pas casser
  // les UserContext construits à la main par les scripts de test P5-P10
  // (aucun besoin d'accès partenaire dans ces suites).
  sousTraitantId?: string | null;
  delegataireCeeId?: string | null;
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
    select: { organisationId: true, role: true, actif: true, sousTraitantId: true, delegataireCeeId: true },
  });
  if (!user || !user.actif) {
    throw new Error("Non autorisé : compte introuvable ou désactivé.");
  }

  return {
    userId,
    organisationId: user.organisationId,
    role: user.role,
    sousTraitantId: user.sousTraitantId,
    delegataireCeeId: user.delegataireCeeId,
  };
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
  | "SIMULATE_REGLEMENTATION"
  // P8 - moteur d'étude (section 31). VIEW_STUDY/RUN_STUDY couvrent la
  // lecture et la simulation (COMMERCIAL peut simuler, mais seulement sur
  // SES dossiers - vérifié en plus au niveau Server Action via
  // canAccessDossierStudy, car ce système de permissions reste par rôle,
  // pas par instance). SAVE_STUDY (enregistrer une étude) et APPLY_STUDY
  // (créer réellement calcul/mouvement à partir d'un scénario) sont des
  // actions d'écriture plus sensibles, réservées à la direction/
  // l'administratif. COMPTABILITE lit les données économiques (VIEW_STUDY)
  // sans simuler/enregistrer/appliquer. REGIE/SOUS_TRAITANT/TECHNIQUE
  // n'ont aucun accès à l'étude (jamais la marge ni les coûts internes -
  // cf. VIEW_MARGIN/VIEW_INTERNAL_COSTS qui les excluent déjà).
  | "VIEW_STUDY"
  | "RUN_STUDY"
  | "SAVE_STUDY"
  | "APPLY_STUDY"
  // P9 - poste de travail commercial (section 34). VIEW_LEADS/MANAGE_LEADS
  // couvrent ses propres leads (restriction par instance vérifiée en plus
  // via canAccessLead, même principe que canAccessDossierStudy en P8).
  // VIEW_TEAM_LEADS lève cette restriction (direction uniquement).
  // ASSIGN_LEADS/IMPORT_LEADS sont des actions plus sensibles (répartition
  // du travail, import en masse) réservées à la direction. RUN_LEAD_STUDY
  // déclenche runDossierStudy (P8) depuis un lead - mêmes rôles que
  // RUN_STUDY, sans TELEPROSPECTEUR (pas son rôle). ADMINISTRATIF ne
  // gère/assigne pas les leads mais peut les consulter une fois convertis
  // (section 34 : "lecture si nécessaire après conversion").
  // REGIE/SOUS_TRAITANT : aucun accès en P9 (pas encore de notion
  // d'appartenance de lead à une régie).
  | "VIEW_LEADS"
  | "MANAGE_LEADS"
  | "ASSIGN_LEADS"
  | "IMPORT_LEADS"
  | "VIEW_TEAM_LEADS"
  | "RUN_LEAD_STUDY"
  // P10 - moteur documentaire (section 33). VIEW_DOCUMENTS/UPLOAD_DOCUMENTS
  // restent assez larges (l'essentiel du travail terrain dépose des
  // pièces) ; VALIDATE_DOCUMENTS (décider qu'une pièce est bonne/refusée)
  // et CREATE_TRANSMISSION_PACKAGE/DOWNLOAD_TRANSMISSION_PACKAGE (générer
  // un envoi officiel à un tiers) sont réservés à la direction/
  // l'administratif. VIEW_SENSITIVE_DOCUMENTS (identité/fiscal) est
  // distinct de VIEW_DOCUMENTS : voir qu'une pièce existe n'est pas la même
  // chose que pouvoir en télécharger le contenu quand elle est sensible.
  // REGIE/SOUS_TRAITANT n'ont aucun accès documentaire général en V1 (pas
  // de lien User<->SousTraitant en base permettant de scoper "uniquement le
  // package qui lui est destiné" - limite documentée).
  | "VIEW_DOCUMENTS"
  | "UPLOAD_DOCUMENTS"
  | "VALIDATE_DOCUMENTS"
  | "VIEW_SENSITIVE_DOCUMENTS"
  | "CREATE_TRANSMISSION_PACKAGE"
  | "DOWNLOAD_TRANSMISSION_PACKAGE"
  // P11 - automatisations (section 45). VIEW_AUTOMATIONS/MANAGE_AUTOMATIONS
  // couvrent le tableau de bord et le paramétrage des règles/templates -
  // réservés à la direction/l'administratif (jamais accessibles à un
  // compte partenaire). PREPARE_COMMUNICATIONS permet à un commercial de
  // préparer un email pour SES dossiers (restriction par instance vérifiée
  // via canAccessDossierCommunication, même principe que canAccessLead) ;
  // SEND_EMAIL_ACTION autorise l'envoi réel d'un brouillon déjà préparé.
  // VIEW_NOTIFICATIONS couvre le centre de notifications interne - jamais
  // un compte partenaire (SOUS_TRAITANT/DELEGATAIRE_CEE), qui n'a pas de
  // notifications internes.
  | "VIEW_AUTOMATIONS"
  | "MANAGE_AUTOMATIONS"
  | "PREPARE_COMMUNICATIONS"
  | "SEND_EMAIL_ACTION"
  | "VIEW_NOTIFICATIONS"
  | "MANAGE_WEBHOOKS";

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
  VIEW_STUDY: ["ADMIN", "COMMERCIAL", "ADMINISTRATIF", "COMPTA", "COMPTABILITE"],
  RUN_STUDY: ["ADMIN", "COMMERCIAL", "ADMINISTRATIF"],
  SAVE_STUDY: ["ADMIN", "ADMINISTRATIF"],
  APPLY_STUDY: ["ADMIN", "ADMINISTRATIF"],
  VIEW_LEADS: ["ADMIN", "COMMERCIAL", "TELEPROSPECTEUR", "ADMINISTRATIF"],
  MANAGE_LEADS: ["ADMIN", "COMMERCIAL", "TELEPROSPECTEUR"],
  ASSIGN_LEADS: ["ADMIN"],
  IMPORT_LEADS: ["ADMIN"],
  VIEW_TEAM_LEADS: ["ADMIN"],
  RUN_LEAD_STUDY: ["ADMIN", "COMMERCIAL", "ADMINISTRATIF"],
  VIEW_DOCUMENTS: ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "TECHNIQUE", "COMPTA", "COMPTABILITE"],
  UPLOAD_DOCUMENTS: ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "TECHNIQUE"],
  VALIDATE_DOCUMENTS: ["ADMIN", "ADMINISTRATIF"],
  VIEW_SENSITIVE_DOCUMENTS: ["ADMIN", "ADMINISTRATIF", "COMPTA", "COMPTABILITE"],
  CREATE_TRANSMISSION_PACKAGE: ["ADMIN", "ADMINISTRATIF"],
  DOWNLOAD_TRANSMISSION_PACKAGE: ["ADMIN", "ADMINISTRATIF"],
  VIEW_AUTOMATIONS: ["ADMIN", "ADMINISTRATIF"],
  MANAGE_AUTOMATIONS: ["ADMIN"],
  PREPARE_COMMUNICATIONS: ["ADMIN", "ADMINISTRATIF", "COMMERCIAL"],
  SEND_EMAIL_ACTION: ["ADMIN", "ADMINISTRATIF", "COMMERCIAL"],
  VIEW_NOTIFICATIONS: ["ADMIN", "ADMINISTRATIF", "COMMERCIAL", "TECHNIQUE", "COMPTA", "COMPTABILITE", "TELEPROSPECTEUR", "REGIE"],
  MANAGE_WEBHOOKS: ["ADMIN"],
};

export function hasPermission(ctx: UserContext, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(ctx.role);
}

// P8 (section 31) : COMMERCIAL ne doit voir/simuler l'étude QUE sur ses
// propres dossiers ("own dossiers"), pas ceux de tout le monde - une
// restriction par instance que le système de permissions par rôle seul ne
// peut pas exprimer. dossier.createdById est la seule notion de
// "propriétaire" déjà présente dans le schéma (pas de champ
// commercialId dédié) ; ADMIN/ADMINISTRATIF/COMPTABILITE voient tous les
// dossiers de leur organisation dès lors qu'ils ont VIEW_STUDY.
export function canAccessDossierStudy(ctx: UserContext, dossier: { createdById: string | null }): boolean {
  if (!hasPermission(ctx, "VIEW_STUDY")) return false;
  if (ctx.role === "COMMERCIAL") return dossier.createdById === ctx.userId;
  return true;
}

// P9 (section 34) : un COMMERCIAL/TELEPROSPECTEUR ne voit que "ses" leads
// (assigné comme commercial OU comme téléprospecteur OU créateur) sauf
// VIEW_TEAM_LEADS (direction). ADMINISTRATIF ne voit un lead qu'une fois
// converti (dossierId renseigné) - "lecture si nécessaire après
// conversion", jamais les leads encore en cours de qualification.
export function canAccessLead(
  ctx: UserContext,
  lead: { commercialId: string | null; teleprospecteurId: string | null; createdById: string | null; dossierId: string | null }
): boolean {
  if (!hasPermission(ctx, "VIEW_LEADS")) return false;
  if (hasPermission(ctx, "VIEW_TEAM_LEADS")) return true;
  if (ctx.role === "ADMINISTRATIF") return lead.dossierId != null;
  return lead.commercialId === ctx.userId || lead.teleprospecteurId === ctx.userId || lead.createdById === ctx.userId;
}

// P11 (section 33/45) - même restriction par instance que
// canAccessDossierStudy/canAccessLead : un COMMERCIAL ne prépare/envoie une
// communication QUE sur SES dossiers (créateur), jamais ceux d'un autre
// commercial. ADMIN/ADMINISTRATIF voient tout dès lors qu'ils ont la
// permission.
export function canAccessDossierCommunication(ctx: UserContext, dossier: { createdById: string | null }): boolean {
  if (!hasPermission(ctx, "PREPARE_COMMUNICATIONS")) return false;
  if (ctx.role === "COMMERCIAL") return dossier.createdById === ctx.userId;
  return true;
}

// P11 (section 23/24) - un compte SOUS_TRAITANT ou DELEGATAIRE_CEE est un
// accès partenaire TRÈS limité, jamais un rôle interne : il ne voit RIEN
// par défaut, seulement ce qui est explicitement rattaché à son entité
// (User.sousTraitantId/delegataireCeeId - jamais déduit d'un nom ou d'une
// simple correspondance texte). Un compte interne (n'importe quel autre
// rôle) n'est jamais un partenaire, même si son entité liée existait par
// erreur en base.
export function isPartnerRole(ctx: UserContext): boolean {
  return ctx.role === "SOUS_TRAITANT" || ctx.role === "DELEGATAIRE_CEE";
}

// Un dossier est visible pour un partenaire uniquement s'il a au moins un
// poste de travaux qui lui est assigné (sous-traitant) - le délégataire
// CEE, lui, n'est jamais assigné à un poste : son périmètre est uniquement
// les packages qui lui sont explicitement destinés (cf.
// canAccessPackageAsPartner), jamais "tous les dossiers où il perçoit du
// CEE" (fuite potentielle d'informations hors packages validés).
export function canAccessDossierAsPartner(
  ctx: UserContext,
  dossier: { postesTravaux: { sousTraitantId: string | null }[] }
): boolean {
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) return false;
  return dossier.postesTravaux.some((p) => p.sousTraitantId === ctx.sousTraitantId);
}

// Un package n'est visible pour un partenaire QUE s'il lui est
// explicitement destiné via destinationSousTraitantId/
// destinationDelegataireCeeId (jamais via destinationName, une chaîne
// libre non fiable pour une décision de sécurité).
export function canAccessPackageAsPartner(
  ctx: UserContext,
  pkg: { destinationSousTraitantId: string | null; destinationDelegataireCeeId: string | null }
): boolean {
  if (ctx.role === "SOUS_TRAITANT") return ctx.sousTraitantId != null && pkg.destinationSousTraitantId === ctx.sousTraitantId;
  if (ctx.role === "DELEGATAIRE_CEE") return ctx.delegataireCeeId != null && pkg.destinationDelegataireCeeId === ctx.delegataireCeeId;
  return false;
}
