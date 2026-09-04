"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUserContext, type UserContext } from "@/lib/authz";
import type { Role } from "@/generated/prisma/enums";

async function requireAdmin(): Promise<UserContext> {
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

// --- Types de dossier ---

export async function createDossierType(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.dossierType.count();
  await prisma.dossierType.create({
    data: { key: slugify(label) || `TYPE_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/types-dossier");
}

export async function updateDossierType(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.dossierType.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/types-dossier");
}

export async function toggleDossierType(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.dossierType.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/types-dossier");
}

// --- Statuts de dossier ---

export async function createDossierStatus(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.dossierStatus.count();
  await prisma.dossierStatus.create({
    data: { key: slugify(label) || `STATUT_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/statuts");
}

export async function updateDossierStatus(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.dossierStatus.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/statuts");
}

export async function toggleDossierStatus(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.dossierStatus.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/statuts");
}

// --- Modes de paiement ---

export async function createModePaiement(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.modePaiement.count();
  await prisma.modePaiement.create({
    data: { key: slugify(label) || `MODE_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/modes-paiement");
}

export async function updateModePaiement(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.modePaiement.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/modes-paiement");
}

export async function toggleModePaiement(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.modePaiement.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/modes-paiement");
}

// --- MAR (accompagnateurs Rénov) ---

export async function createMar(formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  const count = await prisma.mar.count();
  await prisma.mar.create({ data: { nom, ordre: count } });
  revalidatePath("/parametrage/mar");
}

export async function updateMar(id: string, formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  await prisma.mar.update({ where: { id }, data: { nom } });
  revalidatePath("/parametrage/mar");
}

export async function toggleMar(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.mar.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/mar");
}

// --- Statuts ANAH ---

export async function createStatutAnah(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.statutAnah.count();
  await prisma.statutAnah.create({
    data: { key: slugify(label) || `STATUT_ANAH_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/statuts-anah");
}

export async function updateStatutAnah(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.statutAnah.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/statuts-anah");
}

export async function toggleStatutAnah(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.statutAnah.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/statuts-anah");
}

// --- Statuts CEE ---

export async function createStatutCee(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.statutCee.count();
  await prisma.statutCee.create({
    data: { key: slugify(label) || `STATUT_CEE_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/statuts-cee");
}

export async function updateStatutCee(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.statutCee.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/statuts-cee");
}

export async function toggleStatutCee(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.statutCee.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/statuts-cee");
}

// --- Statuts Travaux / Chantier ---

export async function createStatutTravaux(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.statutTravaux.count();
  await prisma.statutTravaux.create({
    data: { key: slugify(label) || `STATUT_TRAVAUX_${count + 1}`, label, ordre: count },
  });
  revalidatePath("/parametrage/statuts-travaux");
}

export async function updateStatutTravaux(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.statutTravaux.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/statuts-travaux");
}

export async function toggleStatutTravaux(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.statutTravaux.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/statuts-travaux");
}

// --- Régie (équipes internes) ---

export async function createRegie(formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  const count = await prisma.regie.count();
  await prisma.regie.create({ data: { nom, ordre: count } });
  revalidatePath("/parametrage/regie");
}

export async function updateRegie(id: string, formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  await prisma.regie.update({ where: { id }, data: { nom } });
  revalidatePath("/parametrage/regie");
}

export async function toggleRegie(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.regie.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/regie");
}

// --- Sous-traitants ---

export async function createSousTraitant(formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  await prisma.sousTraitant.create({
    data: {
      nom,
      typeTravaux: (formData.get("typeTravaux") as never) || null,
      telephone: (formData.get("telephone") as string) || null,
      email: (formData.get("email") as string) || null,
      delaiPaiementJours: formData.get("delaiPaiementJours")
        ? Number(formData.get("delaiPaiementJours"))
        : null,
    },
  });
  revalidatePath("/parametrage/sous-traitants");
}

export async function updateSousTraitant(id: string, formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  await prisma.sousTraitant.update({
    where: { id },
    data: {
      nom,
      typeTravaux: (formData.get("typeTravaux") as never) || null,
      telephone: (formData.get("telephone") as string) || null,
      email: (formData.get("email") as string) || null,
      delaiPaiementJours: formData.get("delaiPaiementJours")
        ? Number(formData.get("delaiPaiementJours"))
        : null,
    },
  });
  revalidatePath("/parametrage/sous-traitants");
}

export async function toggleSousTraitant(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.sousTraitant.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/sous-traitants");
}

export async function deleteSousTraitant(id: string) {
  await requireAdmin();
  try {
    await prisma.sousTraitant.delete({ where: { id } });
  } catch {
    await prisma.sousTraitant.update({ where: { id }, data: { actif: false } });
  }
  revalidatePath("/parametrage/sous-traitants");
}

// --- Délégataires CEE ---

function optionalRachatCts(value: FormDataEntryValue | null): number | undefined {
  if (!value || String(value).trim() === "") return undefined;
  return Math.round(Number(value) * 100);
}

export async function createDelegataireCee(formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  const count = await prisma.delegataireCee.count();
  await prisma.delegataireCee.create({
    data: {
      nom,
      ordre: count,
      rachatTresModesteCts: optionalRachatCts(formData.get("rachatTresModeste")),
      rachatClassiqueCts: optionalRachatCts(formData.get("rachatClassique")),
      delaiPaiementJours: formData.get("delaiPaiementJours")
        ? Number(formData.get("delaiPaiementJours"))
        : undefined,
    },
  });
  revalidatePath("/parametrage/delegataires-cee");
}

export async function updateDelegataireCee(id: string, formData: FormData) {
  await requireAdmin();
  const nom = String(formData.get("nom")).trim();
  if (!nom) return;
  await prisma.delegataireCee.update({
    where: { id },
    data: {
      nom,
      rachatTresModesteCts: optionalRachatCts(formData.get("rachatTresModeste")) ?? null,
      rachatClassiqueCts: optionalRachatCts(formData.get("rachatClassique")) ?? null,
      delaiPaiementJours: formData.get("delaiPaiementJours")
        ? Number(formData.get("delaiPaiementJours"))
        : null,
    },
  });
  revalidatePath("/parametrage/delegataires-cee");
}

export async function toggleDelegataireCee(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.delegataireCee.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/delegataires-cee");
}

// --- Sources de leads (P9, finition section 37) ---

export async function createLeadSource(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.leadSource.count();
  await prisma.leadSource.create({ data: { key: slugify(label) || `SOURCE_${count + 1}`, label, ordre: count } });
  revalidatePath("/parametrage/leads-sources");
}

export async function updateLeadSource(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.leadSource.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/leads-sources");
}

export async function toggleLeadSource(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.leadSource.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/leads-sources");
}

// --- Statuts du pipeline commercial (P9, finition section 37) ---

export async function createLeadPipelineStatus(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.leadPipelineStatus.count();
  await prisma.leadPipelineStatus.create({ data: { key: slugify(label) || `STATUT_LEAD_${count + 1}`, label, ordre: count } });
  revalidatePath("/parametrage/leads-statuts");
}

export async function updateLeadPipelineStatus(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.leadPipelineStatus.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/leads-statuts");
}

export async function toggleLeadPipelineStatus(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.leadPipelineStatus.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/leads-statuts");
}

// --- Résultats d'appel (P9, finition section 37) - la proposition de
// statut/délai de rappel associée reste définie au seed pour l'instant (V1
// : gérer key/label ici suffit, éditer la proposition n'est pas encore
// exposé en UI pour ne pas alourdir ce CRUD générique).
export async function createResultatAppel(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  const count = await prisma.resultatAppel.count();
  await prisma.resultatAppel.create({ data: { key: slugify(label) || `RESULTAT_${count + 1}`, label, ordre: count } });
  revalidatePath("/parametrage/leads-resultats");
}

export async function updateResultatAppel(id: string, formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label")).trim();
  if (!label) return;
  await prisma.resultatAppel.update({ where: { id }, data: { label } });
  revalidatePath("/parametrage/leads-resultats");
}

export async function toggleResultatAppel(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.resultatAppel.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/leads-resultats");
}

// --- Ordre (générique, réutilisé par les listes via le nom du modèle) ---

export async function reorder(
  model:
    | "dossierType"
    | "dossierStatus"
    | "modePaiement"
    | "mar"
    | "statutAnah"
    | "statutCee"
    | "statutTravaux"
    | "regie"
    | "delegataireCee"
    | "leadSource"
    | "leadPipelineStatus"
    | "resultatAppel",
  id: string,
  direction: "up" | "down"
) {
  await requireAdmin();
  const delegate = prisma[model] as {
    findMany: (args: unknown) => Promise<{ id: string; ordre: number }[]>;
    update: (args: unknown) => Promise<unknown>;
  };
  const items = await delegate.findMany({ orderBy: { ordre: "asc" } });
  const index = items.findIndex((i) => i.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= items.length) return;

  await Promise.all([
    delegate.update({ where: { id: items[index].id }, data: { ordre: items[swapWith].ordre } }),
    delegate.update({ where: { id: items[swapWith].id }, data: { ordre: items[index].ordre } }),
  ]);

  const paths: Record<typeof model, string> = {
    dossierType: "/parametrage/types-dossier",
    dossierStatus: "/parametrage/statuts",
    modePaiement: "/parametrage/modes-paiement",
    mar: "/parametrage/mar",
    statutAnah: "/parametrage/statuts-anah",
    statutCee: "/parametrage/statuts-cee",
    statutTravaux: "/parametrage/statuts-travaux",
    regie: "/parametrage/regie",
    delegataireCee: "/parametrage/delegataires-cee",
    leadSource: "/parametrage/leads-sources",
    leadPipelineStatus: "/parametrage/leads-statuts",
    resultatAppel: "/parametrage/leads-resultats",
  };
  revalidatePath(paths[model]);
}

export async function deleteItem(
  model:
    | "dossierType"
    | "dossierStatus"
    | "modePaiement"
    | "mar"
    | "statutAnah"
    | "statutCee"
    | "statutTravaux"
    | "regie"
    | "delegataireCee"
    | "leadSource"
    | "leadPipelineStatus"
    | "resultatAppel",
  id: string
) {
  await requireAdmin();
  const delegate = prisma[model] as {
    delete: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  try {
    await delegate.delete({ where: { id } });
  } catch {
    // Encore référencé par des dossiers (contrainte de clé étrangère) : on archive à la place.
    await delegate.update({ where: { id }, data: { actif: false } });
  }

  const paths: Record<typeof model, string> = {
    dossierType: "/parametrage/types-dossier",
    dossierStatus: "/parametrage/statuts",
    modePaiement: "/parametrage/modes-paiement",
    mar: "/parametrage/mar",
    statutAnah: "/parametrage/statuts-anah",
    statutCee: "/parametrage/statuts-cee",
    statutTravaux: "/parametrage/statuts-travaux",
    regie: "/parametrage/regie",
    delegataireCee: "/parametrage/delegataires-cee",
    leadSource: "/parametrage/leads-sources",
    leadPipelineStatus: "/parametrage/leads-statuts",
    resultatAppel: "/parametrage/leads-resultats",
  };
  revalidatePath(paths[model]);
}

// --- Équipe ---

export async function createUser(formData: FormData) {
  const ctx = await requireAdmin();
  const name = String(formData.get("name")).trim();
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));
  const role = formData.get("role") as Role;
  if (!name || !email || !password || password.length < 8) {
    throw new Error("Nom, email et mot de passe (8 caractères min) requis.");
  }

  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, password: hashed, role, organisationId: ctx.organisationId },
  });
  revalidatePath("/parametrage/equipe");
}

export async function toggleUserActif(id: string, actif: boolean) {
  const ctx = await requireAdmin();
  const target = await prisma.user.findFirst({
    where: { id, organisationId: ctx.organisationId },
    select: { id: true },
  });
  if (!target) throw new Error("Utilisateur introuvable.");
  await prisma.user.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/equipe");
}
