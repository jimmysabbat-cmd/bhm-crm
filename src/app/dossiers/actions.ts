"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { eurosToCents } from "@/lib/money";
import type { Precarite, ZoneClimatique } from "@/generated/prisma/enums";

function generateReference(): string {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `BHM-${y}-${rand}`;
}

export async function createDossier(formData: FormData) {
  const client = await prisma.client.create({
    data: {
      prenom: String(formData.get("prenom")),
      nom: String(formData.get("nom")),
      email: (formData.get("email") as string) || null,
      telephone: (formData.get("telephone") as string) || null,
      adresse: (formData.get("adresse") as string) || null,
      codePostal: (formData.get("codePostal") as string) || null,
      ville: (formData.get("ville") as string) || null,
      precarite: (formData.get("precarite") as Precarite) || null,
      zoneClimatique: (formData.get("zoneClimatique") as ZoneClimatique) || null,
    },
  });

  const statutInitial = await prisma.dossierStatus.findUnique({
    where: { key: "DEVIS_SIGNE" },
  });
  if (!statutInitial) throw new Error("Statut initial 'DEVIS_SIGNE' introuvable - lancez le seed.");

  const dossier = await prisma.dossier.create({
    data: {
      reference: generateReference(),
      clientId: client.id,
      typeId: String(formData.get("typeId")),
      statutId: statutInitial.id,
      montantDevisTTC: eurosToCents(Number(formData.get("montantDevisTTC") || 0)),
      montantAideMPR: eurosToCents(Number(formData.get("montantAideMPR") || 0)),
      montantAideCEE: eurosToCents(Number(formData.get("montantAideCEE") || 0)),
      modePaiementAideId: (formData.get("modePaiementAideId") as string) || null,
      mar: (formData.get("mar") as string) || null,
      delegataireCEE: (formData.get("delegataireCEE") as string) || null,
      dateSignatureDevis: formData.get("dateSignatureDevis")
        ? new Date(String(formData.get("dateSignatureDevis")))
        : null,
    },
  });

  revalidatePath("/dossiers");
  redirect(`/dossiers/${dossier.id}`);
}

export async function updateStatut(dossierId: string, statutId: string) {
  await prisma.dossier.update({ where: { id: dossierId }, data: { statutId } });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/dossiers");
  revalidatePath("/");
}

export async function updateEncaissements(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossier.update({
    where: { id: dossierId },
    data: {
      montantEncaisseClient: eurosToCents(Number(formData.get("montantEncaisseClient") || 0)),
      montantEncaisseMPR: eurosToCents(Number(formData.get("montantEncaisseMPR") || 0)),
      montantEncaisseCEE: eurosToCents(Number(formData.get("montantEncaisseCEE") || 0)),
      dateDebutTravaux: formData.get("dateDebutTravaux")
        ? new Date(String(formData.get("dateDebutTravaux")))
        : null,
      dateFinTravaux: formData.get("dateFinTravaux")
        ? new Date(String(formData.get("dateFinTravaux")))
        : null,
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/");
}

export async function createTache(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.tache.create({
    data: {
      dossierId,
      type: formData.get("type") as never,
      titre: String(formData.get("titre")),
      dateEcheance: new Date(String(formData.get("dateEcheance"))),
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/taches");
}

export async function toggleTache(tacheId: string, done: boolean) {
  const tache = await prisma.tache.update({
    where: { id: tacheId },
    data: { statut: done ? "FAIT" : "A_FAIRE" },
  });
  revalidatePath(`/dossiers/${tache.dossierId}`);
  revalidatePath("/taches");
  revalidatePath("/");
}
