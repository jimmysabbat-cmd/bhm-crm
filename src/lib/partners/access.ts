import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";

// ============================================================
// Accès partenaire (P11, sections 23/24) - un SOUS_TRAITANT ne voit QUE :
// - les dossiers où il a au moins un poste de travaux assigné (jamais tous
//   les dossiers de l'organisation)
// - les postes de travaux qui LUI sont assignés (jamais ceux des autres
//   sous-traitants/de la régie)
// - les TransmissionPackage explicitement destinés à lui
//   (destinationSousTraitantId), jamais via une correspondance de nom
// - les documents CONTENUS dans ces packages, jamais les autres documents
//   du dossier
// Il ne voit JAMAIS : marge, coût interne hors son propre prix de pose,
// avis d'imposition, détail ANAH/MPR, documents hors package, autres
// dossiers, autres partenaires. Un DELEGATAIRE_CEE ne voit que les
// packages qui lui sont destinés (jamais de dossiers/postes - son
// périmètre est strictement les transmissions, section 24).
// ============================================================

export type PartnerDossierRow = {
  dossierId: string;
  reference: string;
  clientNom: string;
  postes: { id: string; type: string; surfaceM2: number | null; montantPoseSousTraitanceCts: number | null }[];
};

export async function getPartnerDossiers(ctx: UserContext): Promise<PartnerDossierRow[]> {
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) return [];
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId: ctx.organisationId, postesTravaux: { some: { sousTraitantId: ctx.sousTraitantId } } },
    select: {
      id: true,
      reference: true,
      client: { select: { prenom: true, nom: true } },
      postesTravaux: { where: { sousTraitantId: ctx.sousTraitantId }, select: { id: true, type: true, surfaceM2: true, montantPoseSousTraitanceCts: true } },
    },
  });
  return dossiers.map((d) => ({
    dossierId: d.id,
    reference: d.reference,
    clientNom: `${d.client.prenom} ${d.client.nom}`,
    postes: d.postesTravaux.map((p) => ({ id: p.id, type: p.type, surfaceM2: p.surfaceM2, montantPoseSousTraitanceCts: p.montantPoseSousTraitanceCts })),
  }));
}

export type PartnerPackageRow = {
  packageId: string;
  dossierReference: string;
  status: string;
  createdAt: Date;
  documents: { id: string; nomFichier: string; typeDocumentNom: string | null }[];
};

export async function getPartnerPackages(ctx: UserContext): Promise<PartnerPackageRow[]> {
  const where =
    ctx.role === "SOUS_TRAITANT" && ctx.sousTraitantId
      ? { destinationSousTraitantId: ctx.sousTraitantId }
      : ctx.role === "DELEGATAIRE_CEE" && ctx.delegataireCeeId
        ? { destinationDelegataireCeeId: ctx.delegataireCeeId }
        : null;
  if (!where) return [];

  const packages = await prisma.transmissionPackage.findMany({
    where: { organisationId: ctx.organisationId, status: { in: ["PRET", "TRANSMIS"] }, ...where },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      dossier: { select: { reference: true } },
      documents: { select: { id: true, dossierDocument: { select: { nomFichier: true } }, typeDocument: { select: { nom: true } } } },
    },
  });
  return packages.map((p) => ({
    packageId: p.id,
    dossierReference: p.dossier.reference,
    status: p.status,
    createdAt: p.createdAt,
    documents: p.documents.map((d) => ({ id: d.id, nomFichier: d.dossierDocument.nomFichier, typeDocumentNom: d.typeDocument?.nom ?? null })),
  }));
}

// ============================================================
// P15 (60 min) - "Mes missions" : TransmissionPackage rattaché à un
// posteTravauxId précis (jamais un package de transmission classique
// ANAH/CEE/etc., qui reste posteTravauxId=null). Un sous-traitant ne voit
// QUE les champs présents dans le snapshot figé au moment de l'envoi
// (jamais les autres champs du Client/du dossier), et QUE les documents
// listés dans ce package (jamais les autres documents du dossier).
// ============================================================

export type PartnerMissionRow = {
  packageId: string;
  dossierReference: string;
  posteTravauxId: string | null;
  posteType: string | null;
  status: string;
  client: Record<string, string>;
  travaux: { type?: string; surfaceM2?: number | null; quantite?: number | null; ficheReglementaireCode?: string | null };
  instructions: string | null;
  prixConvenuCts: number | null;
  dateDebutSouhaitee: Date | null;
  dateFinSouhaitee: Date | null;
  createdAt: Date;
  documents: { id: string; nomFichier: string; typeDocumentNom: string | null }[];
};

export async function getPartnerMissions(ctx: UserContext): Promise<PartnerMissionRow[]> {
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) return [];

  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: ctx.organisationId, destinationSousTraitantId: ctx.sousTraitantId, posteTravauxId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      snapshot: true,
      comment: true,
      prixConvenuCts: true,
      dateDebutSouhaitee: true,
      dateFinSouhaitee: true,
      createdAt: true,
      dossier: { select: { reference: true } },
      posteTravauxId: true,
      posteTravaux: { select: { type: true } },
      documents: { select: { id: true, dossierDocument: { select: { nomFichier: true } }, typeDocument: { select: { nom: true } } } },
    },
  });

  return missions.map((m) => {
    const snap = (m.snapshot ?? {}) as { client?: Record<string, string>; travaux?: PartnerMissionRow["travaux"] };
    return {
      packageId: m.id,
      dossierReference: m.dossier.reference,
      posteTravauxId: m.posteTravauxId,
      posteType: m.posteTravaux?.type ?? null,
      status: m.status,
      client: snap.client ?? {},
      travaux: snap.travaux ?? {},
      instructions: m.comment,
      prixConvenuCts: m.prixConvenuCts,
      dateDebutSouhaitee: m.dateDebutSouhaitee,
      dateFinSouhaitee: m.dateFinSouhaitee,
      createdAt: m.createdAt,
      documents: m.documents.map((d) => ({ id: d.id, nomFichier: d.dossierDocument.nomFichier, typeDocumentNom: d.typeDocument?.nom ?? null })),
    };
  });
}
