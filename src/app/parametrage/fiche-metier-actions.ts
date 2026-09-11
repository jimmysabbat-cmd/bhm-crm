"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import type { FicheMetierCondition } from "@/lib/opportunites/types";
import type { Prisma } from "@/generated/prisma/client";

// ============================================================
// Paramétrage FicheMetier / ArgumentaireMetier (P14). Même convention que
// les autres écrans Paramétrage (requireAdmin + isolation organisationId
// systématique). FicheMetier ne duplique JAMAIS une règle officielle :
// seules des références (FicheMetierProgramme/FicheMetierRegleReglementaire)
// sont créées ici, jamais une copie de contenu réglementaire.
// ============================================================

async function requireAdmin() {
  const ctx = await requireUserContext();
  if ((ctx.effectiveRole ?? ctx.role) !== "ADMIN") {
    throw new Error("Accès réservé aux administrateurs.");
  }
  return ctx;
}

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

export async function listFichesMetier() {
  const ctx = await requireUserContext();
  return prisma.ficheMetier.findMany({
    where: { organisationId: ctx.organisationId },
    orderBy: { ordre: "asc" },
    include: {
      argumentaire: { select: { id: true, code: true, libelle: true } },
      programmes: { include: { programme: { select: { id: true, code: true, nom: true } } } },
      reglesReglementaires: { include: { regleReglementaire: { select: { id: true, code: true, nom: true } } } },
    },
  });
}

export async function createFicheMetier(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const typeTravaux = str(formData, "typeTravaux");
    const code = str(formData, "code");
    const libelle = str(formData, "libelle");
    if (!typeTravaux || !code || !libelle) throw new Error("Métier, code et libellé sont obligatoires.");

    const fiche = await prisma.ficheMetier.create({
      data: {
        organisationId: ctx.organisationId,
        typeTravaux: typeTravaux as never,
        code,
        libelle,
        categorie: str(formData, "categorie"),
        prochaineAction: str(formData, "prochaineAction"),
      },
    });

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true, id: fiche.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function updateFicheMetierConfig(
  ficheMetierId: string,
  params: {
    conditionsActivation?: FicheMetierCondition[];
    donneesNecessairesEligibilite?: string[];
    argumentaireId?: string | null;
    typeRdvRecommande?: string | null;
    controlesTechniques?: string[];
    prochaineAction?: string | null;
    actif?: boolean;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const fiche = await prisma.ficheMetier.findFirst({ where: { id: ficheMetierId, organisationId: ctx.organisationId } });
    if (!fiche) throw new Error("Fiche métier introuvable.");

    await prisma.ficheMetier.update({
      where: { id: fiche.id },
      data: {
        conditionsActivation: params.conditionsActivation !== undefined ? (params.conditionsActivation as unknown as Prisma.InputJsonValue) : undefined,
        donneesNecessairesEligibilite:
          params.donneesNecessairesEligibilite !== undefined ? (params.donneesNecessairesEligibilite as unknown as Prisma.InputJsonValue) : undefined,
        argumentaireId: params.argumentaireId !== undefined ? params.argumentaireId : undefined,
        typeRdvRecommande: params.typeRdvRecommande !== undefined ? (params.typeRdvRecommande as never) : undefined,
        controlesTechniques: params.controlesTechniques !== undefined ? (params.controlesTechniques as unknown as Prisma.InputJsonValue) : undefined,
        prochaineAction: params.prochaineAction !== undefined ? params.prochaineAction : undefined,
        actif: params.actif !== undefined ? params.actif : undefined,
      },
    });

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Ajoute/retire un lien FicheMetier <-> Programme (jointure N:N - jamais Programme.typeTravaux). */
export async function toggleFicheMetierProgramme(ficheMetierId: string, programmeId: string, linked: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const [fiche, programme] = await Promise.all([
      prisma.ficheMetier.findFirst({ where: { id: ficheMetierId, organisationId: ctx.organisationId } }),
      prisma.programme.findFirst({ where: { id: programmeId, organisationId: ctx.organisationId } }),
    ]);
    if (!fiche || !programme) throw new Error("Fiche métier ou programme introuvable.");

    if (linked) {
      await prisma.ficheMetierProgramme.upsert({
        where: { ficheMetierId_programmeId: { ficheMetierId, programmeId } },
        update: {},
        create: { ficheMetierId, programmeId },
      });
    } else {
      await prisma.ficheMetierProgramme.deleteMany({ where: { ficheMetierId, programmeId } });
    }

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Ajoute/retire un lien FicheMetier <-> RegleReglementaire (fiche officielle, jamais une version précise). */
export async function toggleFicheMetierRegle(ficheMetierId: string, regleReglementaireId: string, linked: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const fiche = await prisma.ficheMetier.findFirst({ where: { id: ficheMetierId, organisationId: ctx.organisationId } });
    if (!fiche) throw new Error("Fiche métier introuvable.");
    // RegleReglementaire est globale (jamais organisationId) - seule
    // l'existence est vérifiée, jamais un scoping tenant sur cette table.
    const regle = await prisma.regleReglementaire.findUnique({ where: { id: regleReglementaireId } });
    if (!regle) throw new Error("Règle réglementaire introuvable.");

    if (linked) {
      await prisma.ficheMetierRegleReglementaire.upsert({
        where: { ficheMetierId_regleReglementaireId: { ficheMetierId, regleReglementaireId } },
        update: {},
        create: { ficheMetierId, regleReglementaireId },
      });
    } else {
      await prisma.ficheMetierRegleReglementaire.deleteMany({ where: { ficheMetierId, regleReglementaireId } });
    }

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

// --- ArgumentaireMetier ---

export async function createArgumentaireMetier(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const typeTravaux = str(formData, "typeTravaux");
    const code = str(formData, "code");
    const libelle = str(formData, "libelle");
    if (!typeTravaux || !code || !libelle) throw new Error("Métier, code et libellé sont obligatoires.");

    const argumentaire = await prisma.argumentaireMetier.create({
      data: {
        organisationId: ctx.organisationId,
        typeTravaux: typeTravaux as never,
        code,
        libelle,
        pourquoi: str(formData, "pourquoi"),
        benefices: str(formData, "benefices"),
        aConfirmer: str(formData, "aConfirmer"),
        prochaineEtape: str(formData, "prochaineEtape"),
      },
    });

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true, id: argumentaire.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function updateArgumentaireMetier(id: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const argumentaire = await prisma.argumentaireMetier.findFirst({ where: { id, organisationId: ctx.organisationId } });
    if (!argumentaire) throw new Error("Argumentaire introuvable.");

    await prisma.argumentaireMetier.update({
      where: { id },
      data: {
        pourquoi: str(formData, "pourquoi"),
        benefices: str(formData, "benefices"),
        aConfirmer: str(formData, "aConfirmer"),
        prochaineEtape: str(formData, "prochaineEtape"),
      },
    });

    revalidatePath("/parametrage/fiches-metier");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
