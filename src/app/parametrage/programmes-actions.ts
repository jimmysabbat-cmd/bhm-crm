"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const ctx = await requireUserContext();
  if (ctx.role !== "ADMIN") {
    throw new Error("Accès réservé aux administrateurs.");
  }
  return ctx;
}

function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Une version publiée est figée structurellement : pour la faire évoluer,
// on la duplique plutôt que de la modifier en place, afin que les dossiers
// déjà engagés sous cette version ne changent jamais de comportement.
async function requireVersionModifiable(programmeVersionId: string, organisationId: string) {
  const version = await prisma.programmeVersion.findFirst({
    where: { id: programmeVersionId, programme: { organisationId } },
    select: { id: true, publie: true, programmeId: true },
  });
  if (!version) throw new Error("Version de programme introuvable.");
  if (version.publie) {
    throw new Error("Cette version est publiée et figée - dupliquez-la pour la modifier.");
  }
  return version;
}

// --- Programme ---

export async function createProgramme(formData: FormData) {
  const ctx = await requireAdmin();
  const nom = String(formData.get("nom") || "").trim();
  const description = (formData.get("description") as string) || null;
  if (!nom) return;

  const programme = await prisma.programme.create({
    data: { organisationId: ctx.organisationId, nom, code: slugify(nom), description },
  });
  revalidatePath("/parametrage/programmes");
  redirect(`/parametrage/programmes/${programme.id}`);
}

export async function toggleProgrammeActif(id: string, actif: boolean) {
  const ctx = await requireAdmin();
  const programme = await prisma.programme.findFirst({ where: { id, organisationId: ctx.organisationId } });
  if (!programme) throw new Error("Programme introuvable.");
  await prisma.programme.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/programmes");
}

// --- ProgrammeVersion ---

export async function createProgrammeVersion(formData: FormData) {
  const ctx = await requireAdmin();
  const programmeId = String(formData.get("programmeId"));
  const numeroVersion = String(formData.get("numeroVersion") || "").trim();
  const nomVersion = (formData.get("nomVersion") as string) || null;
  if (!numeroVersion) return;

  const programme = await prisma.programme.findFirst({
    where: { id: programmeId, organisationId: ctx.organisationId },
  });
  if (!programme) throw new Error("Programme introuvable.");

  await prisma.programmeVersion.create({
    data: { programmeId, numeroVersion, nomVersion },
  });
  revalidatePath(`/parametrage/programmes/${programmeId}`);
}

// Duplique une version (étapes, dépendances, modèles de tâches, documents
// requis) dans une nouvelle version non publiée du même programme, pour
// permettre de faire évoluer un programme sans jamais modifier une version
// déjà en cours d'utilisation.
export async function dupliquerProgrammeVersion(versionId: string, formData: FormData) {
  const ctx = await requireAdmin();
  const numeroVersion = String(formData.get("numeroVersion") || "").trim();
  if (!numeroVersion) return;

  const source = await prisma.programmeVersion.findFirst({
    where: { id: versionId, programme: { organisationId: ctx.organisationId } },
    include: {
      etapes: { include: { dependances: true, modelesTaches: true, documentsRequis: true } },
    },
  });
  if (!source) throw new Error("Version introuvable.");

  const nouvelle = await prisma.programmeVersion.create({
    data: {
      programmeId: source.programmeId,
      numeroVersion,
      nomVersion: source.nomVersion,
      dateDebutEffet: source.dateDebutEffet,
    },
  });

  const anciensVersNouveaux = new Map<string, string>();
  for (const etape of source.etapes) {
    const copie = await prisma.etapeProgramme.create({
      data: {
        programmeVersionId: nouvelle.id,
        code: etape.code,
        nom: etape.nom,
        description: etape.description,
        ordre: etape.ordre,
        typeFlux: etape.typeFlux,
        delaiNormalJours: etape.delaiNormalJours,
        delaiAlerteJours: etape.delaiAlerteJours,
        roleResponsable: etape.roleResponsable,
        obligatoire: etape.obligatoire,
        actif: etape.actif,
      },
    });
    anciensVersNouveaux.set(etape.id, copie.id);
  }
  for (const etape of source.etapes) {
    const nouvelEtapeId = anciensVersNouveaux.get(etape.id)!;
    for (const dep of etape.dependances) {
      const nouvelDependsOnId = anciensVersNouveaux.get(dep.dependsOnEtapeId);
      if (!nouvelDependsOnId) continue;
      await prisma.etapeDependance.create({
        data: { etapeId: nouvelEtapeId, dependsOnEtapeId: nouvelDependsOnId, type: dep.type },
      });
    }
    for (const modele of etape.modelesTaches) {
      await prisma.modeleTacheEtape.create({
        data: {
          etapeProgrammeId: nouvelEtapeId,
          titre: modele.titre,
          description: modele.description,
          type: modele.type,
          delaiJours: modele.delaiJours,
          roleResponsable: modele.roleResponsable,
          obligatoire: modele.obligatoire,
          actif: modele.actif,
        },
      });
    }
    for (const doc of etape.documentsRequis) {
      await prisma.etapeDocumentRequis.create({
        data: { etapeProgrammeId: nouvelEtapeId, typeDocument: doc.typeDocument, obligatoire: doc.obligatoire },
      });
    }
  }

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "ProgrammeVersion",
    entityId: nouvelle.id,
    action: "DUPLIQUER",
    metadata: { depuisVersionId: versionId, numeroVersion },
  });

  revalidatePath(`/parametrage/programmes/${source.programmeId}`);
  redirect(`/parametrage/programmes/${source.programmeId}/versions/${nouvelle.id}`);
}

export async function publierProgrammeVersion(versionId: string) {
  const ctx = await requireAdmin();
  const version = await prisma.programmeVersion.findFirst({
    where: { id: versionId, programme: { organisationId: ctx.organisationId } },
    include: { etapes: true },
  });
  if (!version) throw new Error("Version introuvable.");
  if (version.etapes.length === 0) {
    throw new Error("Impossible de publier une version sans étape.");
  }

  await prisma.programmeVersion.update({ where: { id: versionId }, data: { publie: true } });
  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "ProgrammeVersion",
    entityId: versionId,
    action: "PUBLIER",
    metadata: { numeroVersion: version.numeroVersion },
  });
  revalidatePath(`/parametrage/programmes/${version.programmeId}`);
  revalidatePath(`/parametrage/programmes/${version.programmeId}/versions/${versionId}`);
}

// --- EtapeProgramme ---

export async function createEtapeProgramme(formData: FormData) {
  const ctx = await requireAdmin();
  const programmeVersionId = String(formData.get("programmeVersionId"));
  await requireVersionModifiable(programmeVersionId, ctx.organisationId);

  const nom = String(formData.get("nom") || "").trim();
  if (!nom) return;

  const count = await prisma.etapeProgramme.count({ where: { programmeVersionId } });
  await prisma.etapeProgramme.create({
    data: {
      programmeVersionId,
      code: slugify(nom) || `ETAPE_${count + 1}`,
      nom,
      ordre: count,
      typeFlux: (formData.get("typeFlux") as never) || "AUTRE",
      delaiNormalJours: formData.get("delaiNormalJours") ? Number(formData.get("delaiNormalJours")) : null,
      delaiAlerteJours: formData.get("delaiAlerteJours") ? Number(formData.get("delaiAlerteJours")) : null,
      roleResponsable: (formData.get("roleResponsable") as never) || null,
      obligatoire: formData.get("obligatoire") === "on",
    },
  });
  revalidatePath(`/parametrage/programmes`);
}

export async function updateEtapeProgramme(etapeId: string, formData: FormData) {
  const ctx = await requireAdmin();
  const etape = await prisma.etapeProgramme.findFirst({
    where: { id: etapeId, programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    select: { programmeVersionId: true },
  });
  if (!etape) throw new Error("Étape introuvable.");
  await requireVersionModifiable(etape.programmeVersionId, ctx.organisationId);

  const nom = String(formData.get("nom") || "").trim();
  if (!nom) return;

  await prisma.etapeProgramme.update({
    where: { id: etapeId },
    data: {
      nom,
      description: (formData.get("description") as string) || null,
      typeFlux: (formData.get("typeFlux") as never) || "AUTRE",
      delaiNormalJours: formData.get("delaiNormalJours") ? Number(formData.get("delaiNormalJours")) : null,
      delaiAlerteJours: formData.get("delaiAlerteJours") ? Number(formData.get("delaiAlerteJours")) : null,
      roleResponsable: (formData.get("roleResponsable") as never) || null,
      obligatoire: formData.get("obligatoire") === "on",
    },
  });
  revalidatePath(`/parametrage/programmes`);
}

export async function deleteEtapeProgramme(etapeId: string) {
  const ctx = await requireAdmin();
  const etape = await prisma.etapeProgramme.findFirst({
    where: { id: etapeId, programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    select: { programmeVersionId: true },
  });
  if (!etape) throw new Error("Étape introuvable.");
  await requireVersionModifiable(etape.programmeVersionId, ctx.organisationId);

  await prisma.etapeProgramme.delete({ where: { id: etapeId } });
  revalidatePath(`/parametrage/programmes`);
}

export async function reorderEtapeProgramme(
  programmeVersionId: string,
  etapeId: string,
  direction: "up" | "down"
) {
  const ctx = await requireAdmin();
  await requireVersionModifiable(programmeVersionId, ctx.organisationId);

  const etapes = await prisma.etapeProgramme.findMany({
    where: { programmeVersionId },
    orderBy: { ordre: "asc" },
  });
  const index = etapes.findIndex((e) => e.id === etapeId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= etapes.length) return;

  await Promise.all([
    prisma.etapeProgramme.update({ where: { id: etapes[index].id }, data: { ordre: etapes[swapWith].ordre } }),
    prisma.etapeProgramme.update({ where: { id: etapes[swapWith].id }, data: { ordre: etapes[index].ordre } }),
  ]);
  revalidatePath(`/parametrage/programmes`);
}

// Remplace l'ensemble des dépendances d'une étape (coché = dépend de).
export async function setEtapeDependances(etapeId: string, formData: FormData) {
  const ctx = await requireAdmin();
  const etape = await prisma.etapeProgramme.findFirst({
    where: { id: etapeId, programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    select: { programmeVersionId: true },
  });
  if (!etape) throw new Error("Étape introuvable.");
  await requireVersionModifiable(etape.programmeVersionId, ctx.organisationId);

  const dependsOnIds = formData.getAll("dependsOnEtapeId").map(String).filter((v) => v && v !== etapeId);

  await prisma.$transaction([
    prisma.etapeDependance.deleteMany({ where: { etapeId } }),
    ...dependsOnIds.map((dependsOnEtapeId) =>
      prisma.etapeDependance.create({ data: { etapeId, dependsOnEtapeId } })
    ),
  ]);
  revalidatePath(`/parametrage/programmes`);
}

// --- ModeleTacheEtape ---

export async function createModeleTacheEtape(formData: FormData) {
  const ctx = await requireAdmin();
  const etapeProgrammeId = String(formData.get("etapeProgrammeId"));
  const etape = await prisma.etapeProgramme.findFirst({
    where: { id: etapeProgrammeId, programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    select: { programmeVersionId: true },
  });
  if (!etape) throw new Error("Étape introuvable.");
  await requireVersionModifiable(etape.programmeVersionId, ctx.organisationId);

  const titre = String(formData.get("titre") || "").trim();
  if (!titre) return;

  await prisma.modeleTacheEtape.create({
    data: {
      etapeProgrammeId,
      titre,
      type: (formData.get("type") as never) || "AUTRE",
      delaiJours: formData.get("delaiJours") ? Number(formData.get("delaiJours")) : 0,
      roleResponsable: (formData.get("roleResponsable") as never) || null,
    },
  });
  revalidatePath(`/parametrage/programmes`);
}

export async function deleteModeleTacheEtape(modeleId: string) {
  const ctx = await requireAdmin();
  const modele = await prisma.modeleTacheEtape.findFirst({
    where: { id: modeleId, etapeProgramme: { programmeVersion: { programme: { organisationId: ctx.organisationId } } } },
    select: { etapeProgramme: { select: { programmeVersionId: true } } },
  });
  if (!modele) throw new Error("Modèle de tâche introuvable.");
  await requireVersionModifiable(modele.etapeProgramme.programmeVersionId, ctx.organisationId);

  await prisma.modeleTacheEtape.delete({ where: { id: modeleId } });
  revalidatePath(`/parametrage/programmes`);
}

// --- EtapeDocumentRequis ---

export async function createDocumentRequis(formData: FormData) {
  const ctx = await requireAdmin();
  const etapeProgrammeId = String(formData.get("etapeProgrammeId"));
  const etape = await prisma.etapeProgramme.findFirst({
    where: { id: etapeProgrammeId, programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    select: { programmeVersionId: true },
  });
  if (!etape) throw new Error("Étape introuvable.");
  await requireVersionModifiable(etape.programmeVersionId, ctx.organisationId);

  const typeDocument = formData.get("typeDocument") as never;
  if (!typeDocument) return;

  await prisma.etapeDocumentRequis.upsert({
    where: { etapeProgrammeId_typeDocument: { etapeProgrammeId, typeDocument } },
    update: {},
    create: { etapeProgrammeId, typeDocument },
  });
  revalidatePath(`/parametrage/programmes`);
}

export async function deleteDocumentRequis(documentRequisId: string) {
  const ctx = await requireAdmin();
  const doc = await prisma.etapeDocumentRequis.findFirst({
    where: {
      id: documentRequisId,
      etapeProgramme: { programmeVersion: { programme: { organisationId: ctx.organisationId } } },
    },
    select: { etapeProgramme: { select: { programmeVersionId: true } } },
  });
  if (!doc) throw new Error("Document requis introuvable.");
  await requireVersionModifiable(doc.etapeProgramme.programmeVersionId, ctx.organisationId);

  await prisma.etapeDocumentRequis.delete({ where: { id: documentRequisId } });
  revalidatePath(`/parametrage/programmes`);
}
