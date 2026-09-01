"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { eurosToCents } from "@/lib/money";
import { saveDocumentFile, deleteDocumentFile } from "@/lib/documents";
import type { Precarite, ZoneClimatique, TypeTravaux, TypeDocument } from "@/generated/prisma/enums";

function optionalEurosToCents(value: FormDataEntryValue | null): number | null {
  if (!value || String(value).trim() === "") return null;
  return eurosToCents(Number(value));
}

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
      marId: (formData.get("marId") as string) || null,
      delegataireCeeId: (formData.get("delegataireCeeId") as string) || null,
      dateDepotAnah: formData.get("dateDepotAnah")
        ? new Date(String(formData.get("dateDepotAnah")))
        : null,
      dateOctroiAnah: formData.get("dateOctroiAnah")
        ? new Date(String(formData.get("dateOctroiAnah")))
        : null,
      dateSignatureDevis: formData.get("dateSignatureDevis")
        ? new Date(String(formData.get("dateSignatureDevis")))
        : null,
    },
  });

  revalidatePath("/dossiers");
  redirect(`/dossiers/${dossier.id}`);
}

export async function updateClientInfo(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  const dossier = await prisma.dossier.findUniqueOrThrow({
    where: { id: dossierId },
    select: { clientId: true },
  });

  await prisma.client.update({
    where: { id: dossier.clientId },
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
  await prisma.dossier.update({
    where: { id: dossierId },
    data: { typeId: String(formData.get("typeId")) },
  });

  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/dossiers");
  revalidatePath("/");
}

export async function updateMontage(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossier.update({
    where: { id: dossierId },
    data: {
      montantDevisTTC: eurosToCents(Number(formData.get("montantDevisTTC") || 0)),
      montantAideMPR: eurosToCents(Number(formData.get("montantAideMPR") || 0)),
      montantAideCEE: eurosToCents(Number(formData.get("montantAideCEE") || 0)),
      modePaiementAideId: (formData.get("modePaiementAideId") as string) || null,
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/");
}

export async function updateStatut(dossierId: string, statutId: string) {
  await prisma.dossier.update({ where: { id: dossierId }, data: { statutId } });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/dossiers");
  revalidatePath("/");
}

export async function updateAnahInfo(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossier.update({
    where: { id: dossierId },
    data: {
      marId: (formData.get("marId") as string) || null,
      statutAnahId: (formData.get("statutAnahId") as string) || null,
      dateDepotAnah: formData.get("dateDepotAnah")
        ? new Date(String(formData.get("dateDepotAnah")))
        : null,
      dateOctroiAnah: formData.get("dateOctroiAnah")
        ? new Date(String(formData.get("dateOctroiAnah")))
        : null,
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function updateEncaissements(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossier.update({
    where: { id: dossierId },
    data: {
      montantEncaisseClient: eurosToCents(Number(formData.get("montantEncaisseClient") || 0)),
      montantEncaisseMPR: eurosToCents(Number(formData.get("montantEncaisseMPR") || 0)),
      montantEncaisseCEE: eurosToCents(Number(formData.get("montantEncaisseCEE") || 0)),
      delegataireCeeId: (formData.get("delegataireCeeId") as string) || null,
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

export async function createPosteTravaux(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossierPosteTravaux.create({
    data: {
      dossierId,
      type: formData.get("type") as TypeTravaux,
      surfaceM2: formData.get("surfaceM2") ? Number(formData.get("surfaceM2")) : null,
      montantCumac: formData.get("montantCumac") ? Number(formData.get("montantCumac")) : null,
      montantPrimeCalculeCts: optionalEurosToCents(formData.get("montantPrimeCalcule")),
      sousTraitantId: (formData.get("sousTraitantId") as string) || null,
      montantPoseSousTraitanceCts: optionalEurosToCents(formData.get("montantPoseSousTraitance")),
      regieId: (formData.get("regieId") as string) || null,
      montantRegieCts: optionalEurosToCents(formData.get("montantRegie")),
      montantMaterielHTCts: optionalEurosToCents(formData.get("montantMaterielHT")),
      montantMaterielTTCCts: optionalEurosToCents(formData.get("montantMaterielTTC")),
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function updatePosteTravaux(posteId: string, formData: FormData) {
  const poste = await prisma.dossierPosteTravaux.update({
    where: { id: posteId },
    data: {
      type: formData.get("type") as TypeTravaux,
      surfaceM2: formData.get("surfaceM2") ? Number(formData.get("surfaceM2")) : null,
      montantCumac: formData.get("montantCumac") ? Number(formData.get("montantCumac")) : null,
      montantPrimeCalculeCts: optionalEurosToCents(formData.get("montantPrimeCalcule")),
      sousTraitantId: (formData.get("sousTraitantId") as string) || null,
      montantPoseSousTraitanceCts: optionalEurosToCents(formData.get("montantPoseSousTraitance")),
      regieId: (formData.get("regieId") as string) || null,
      montantRegieCts: optionalEurosToCents(formData.get("montantRegie")),
      montantMaterielHTCts: optionalEurosToCents(formData.get("montantMaterielHT")),
      montantMaterielTTCCts: optionalEurosToCents(formData.get("montantMaterielTTC")),
    },
  });
  revalidatePath(`/dossiers/${poste.dossierId}`);
}

export async function deletePosteTravaux(posteId: string, dossierId: string) {
  await prisma.dossierPosteTravaux.delete({ where: { id: posteId } });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function uploadDocument(formData: FormData) {
  const dossierId = String(formData.get("dossierId"));
  const file = formData.get("file") as File;
  if (!file || file.size === 0) return;

  const saved = await saveDocumentFile(dossierId, file);
  await prisma.dossierDocument.create({
    data: {
      dossierId,
      type: formData.get("type") as TypeDocument,
      ...saved,
    },
  });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function deleteDocument(docId: string, dossierId: string) {
  const doc = await prisma.dossierDocument.findUnique({ where: { id: docId } });
  if (!doc) return;
  await deleteDocumentFile(doc.cheminFichier);
  await prisma.dossierDocument.delete({ where: { id: docId } });
  revalidatePath(`/dossiers/${dossierId}`);
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

export async function updateTache(tacheId: string, formData: FormData) {
  const tache = await prisma.tache.update({
    where: { id: tacheId },
    data: {
      titre: String(formData.get("titre")),
      type: formData.get("type") as never,
      dateEcheance: new Date(String(formData.get("dateEcheance"))),
    },
  });
  revalidatePath(`/dossiers/${tache.dossierId}`);
  revalidatePath("/taches");
  revalidatePath("/");
}

export async function deleteTache(tacheId: string, dossierId: string) {
  await prisma.tache.delete({ where: { id: tacheId } });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/taches");
  revalidatePath("/");
}
