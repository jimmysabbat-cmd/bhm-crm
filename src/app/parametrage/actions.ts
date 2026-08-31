"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma/enums";

async function requireAdmin() {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "ADMIN") {
    throw new Error("Accès réservé aux administrateurs.");
  }
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

// --- Ordre (générique, réutilisé par les 3 listes via le nom du modèle) ---

export async function reorder(
  model: "dossierType" | "dossierStatus" | "modePaiement",
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
  };
  revalidatePath(paths[model]);
}

// --- Équipe ---

export async function createUser(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name")).trim();
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));
  const role = formData.get("role") as Role;
  if (!name || !email || !password || password.length < 8) {
    throw new Error("Nom, email et mot de passe (8 caractères min) requis.");
  }

  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, password: hashed, role },
  });
  revalidatePath("/parametrage/equipe");
}

export async function toggleUserActif(id: string, actif: boolean) {
  await requireAdmin();
  await prisma.user.update({ where: { id }, data: { actif } });
  revalidatePath("/parametrage/equipe");
}
