"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, isPartnerRole, canAccessPackageAsPartner } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { createMissionPackage, type ChampsClientPartages } from "@/lib/documents/mission";

// ============================================================
// P15 (60 min) - Server Actions "Envoyer en mission" + réponse
// sous-traitant (accepter/refuser). Réutilise TransmissionPackage (P10).
// ============================================================

export async function getSousTraitantsActifsAction(): Promise<{ id: string; nom: string }[]> {
  const ctx = await requireUserContext();
  const list = await prisma.sousTraitant.findMany({
    where: { organisationId: ctx.organisationId, actif: true },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });
  return list;
}

// P16 - équipes internes (régie) pouvant recevoir une mission au même
// titre qu'un sous-traitant externe (cf. createMissionPackage).
export async function getRegiesActivesAction(): Promise<{ id: string; nom: string }[]> {
  const ctx = await requireUserContext();
  const list = await prisma.regie.findMany({
    where: { organisationId: ctx.organisationId, actif: true },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });
  return list;
}

// P16 - missions (ST ou régie) déjà envoyées pour ce dossier, pour les
// afficher sur la page dossier (cockpit) plutôt que de les laisser
// invisibles une fois créées (seul "Envoyer en mission" existait en P15).
export type MissionRow = {
  id: string;
  posteTravauxId: string | null;
  destinataireNom: string;
  destinataireType: "SOUS_TRAITANT" | "REGIE";
  status: string;
  dateDebutSouhaitee: Date | null;
  dateFinSouhaitee: Date | null;
  prixConvenuCts: number | null;
};

export async function getMissionsForDossierAction(dossierId: string): Promise<MissionRow[]> {
  const ctx = await requireUserContext();
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");

  const missions = await prisma.transmissionPackage.findMany({
    where: { dossierId, organisationId: ctx.organisationId, posteTravauxId: { not: null } },
    select: {
      id: true,
      posteTravauxId: true,
      status: true,
      dateDebutSouhaitee: true,
      dateFinSouhaitee: true,
      prixConvenuCts: true,
      destinationType: true,
      destinationSousTraitant: { select: { nom: true } },
      destinationRegie: { select: { nom: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return missions.map((m) => ({
    id: m.id,
    posteTravauxId: m.posteTravauxId,
    destinataireNom: m.destinationSousTraitant?.nom ?? m.destinationRegie?.nom ?? "—",
    destinataireType: m.destinationType === "REGIE" ? "REGIE" : "SOUS_TRAITANT",
    status: m.status,
    dateDebutSouhaitee: m.dateDebutSouhaitee,
    dateFinSouhaitee: m.dateFinSouhaitee,
    prixConvenuCts: m.prixConvenuCts,
  }));
}

export async function getDossierDocumentsAction(dossierId: string): Promise<{ id: string; nomFichier: string; typeNom: string | null }[]> {
  const ctx = await requireUserContext();
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId: ctx.organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");
  const docs = await prisma.dossierDocument.findMany({
    where: { dossierId, statut: { not: "REMPLACE" } },
    select: { id: true, nomFichier: true, typeDocumentRef: { select: { nom: true } } },
    orderBy: { createdAt: "desc" },
  });
  return docs.map((d) => ({ id: d.id, nomFichier: d.nomFichier, typeNom: d.typeDocumentRef?.nom ?? null }));
}

export async function envoyerEnMissionAction(input: {
  dossierId: string;
  posteTravauxId: string;
  sousTraitantId: string | null;
  regieId: string | null;
  champsPartages: ChampsClientPartages;
  documentIds: string[];
  dateDebutSouhaitee: string | null;
  dateFinSouhaitee: string | null;
  instructions: string | null;
  prixConvenuCts: number | null;
}): Promise<{ ok: true; packageId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");

    const packageId = await createMissionPackage({
      organisationId: ctx.organisationId,
      dossierId: input.dossierId,
      posteTravauxId: input.posteTravauxId,
      sousTraitantId: input.sousTraitantId,
      regieId: input.regieId,
      champsPartages: input.champsPartages,
      documentIds: input.documentIds,
      dateDebutSouhaitee: input.dateDebutSouhaitee ? new Date(input.dateDebutSouhaitee) : null,
      dateFinSouhaitee: input.dateFinSouhaitee ? new Date(input.dateFinSouhaitee) : null,
      instructions: input.instructions,
      prixConvenuCts: input.prixConvenuCts,
      createdById: ctx.userId,
    });

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "TransmissionPackage",
      entityId: packageId,
      action: "MISSION_ENVOYEE",
      metadata: { dossierId: input.dossierId, posteTravauxId: input.posteTravauxId, sousTraitantId: input.sousTraitantId, regieId: input.regieId },
    });

    revalidatePath(`/dossiers/${input.dossierId}`);
    return { ok: true, packageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

// P16 - pilotage interne du statut d'une mission (ST ou régie) au-delà du
// simple accepter/refuser côté partenaire : un admin/commercial fait
// avancer PLANIFIEE -> EN_COURS -> TERMINEE (nécessaire notamment pour une
// équipe interne, qui n'a pas de portail pour répondre elle-même). Jamais
// utilisable pour repasser une mission REFUSEE à ENVOYEE (repartir d'une
// nouvelle mission dans ce cas, jamais réécrire l'historique).
const STATUTS_PILOTABLES = ["ENVOYEE", "ACCEPTEE", "PLANIFIEE", "EN_COURS", "TERMINEE"] as const;

export async function updateMissionStatutAction(
  packageId: string,
  statut: (typeof STATUTS_PILOTABLES)[number]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE")) throw new Error("Accès refusé.");
    if (!STATUTS_PILOTABLES.includes(statut)) throw new Error("Statut invalide.");

    const pkg = await prisma.transmissionPackage.findFirst({ where: { id: packageId, organisationId: ctx.organisationId } });
    if (!pkg) throw new Error("Mission introuvable.");
    if (pkg.status === "REFUSEE" || pkg.status === "ANNULE") throw new Error("Cette mission est refusée/annulée, son statut ne peut plus être modifié ici.");

    await prisma.transmissionPackage.update({ where: { id: pkg.id }, data: { status: statut } });
    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "TransmissionPackage",
      entityId: pkg.id,
      action: "MISSION_STATUT_MODIFIE",
      metadata: { dossierId: pkg.dossierId, statut },
    });

    revalidatePath(`/dossiers/${pkg.dossierId}`);
    revalidatePath("/planning");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function loadOwnedMissionAsPartner(packageId: string) {
  const ctx = await requireUserContext();
  if (!isPartnerRole(ctx)) throw new Error("Accès refusé.");
  const pkg = await prisma.transmissionPackage.findFirst({ where: { id: packageId, organisationId: ctx.organisationId } });
  if (!pkg) throw new Error("Mission introuvable.");
  if (!canAccessPackageAsPartner(ctx, pkg)) throw new Error("Accès refusé.");
  return { ctx, pkg };
}

export async function accepterMissionAction(packageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { ctx, pkg } = await loadOwnedMissionAsPartner(packageId);
    if (pkg.status !== "ENVOYEE") throw new Error("Seule une mission envoyée peut être acceptée.");

    await prisma.transmissionPackage.update({
      where: { id: pkg.id },
      data: { status: "ACCEPTEE", respondedAt: new Date(), respondedById: ctx.userId },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "MISSION_ACCEPTEE", metadata: { dossierId: pkg.dossierId } });

    revalidatePath("/partenaire");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function refuserMissionAction(packageId: string, reason: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { ctx, pkg } = await loadOwnedMissionAsPartner(packageId);
    if (pkg.status !== "ENVOYEE") throw new Error("Seule une mission envoyée peut être refusée.");

    await prisma.transmissionPackage.update({
      where: { id: pkg.id },
      data: { status: "REFUSEE", respondedAt: new Date(), respondedById: ctx.userId, refusalReason: reason },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "TransmissionPackage", entityId: pkg.id, action: "MISSION_REFUSEE", metadata: { dossierId: pkg.dossierId, reason: reason ?? "" } });

    revalidatePath("/partenaire");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
