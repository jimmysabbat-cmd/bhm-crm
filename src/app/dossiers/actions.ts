"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
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
  const session = await requireAuth();
  const createdById = (session.user as { id?: string } | undefined)?.id ?? null;

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
      surfaceHabitableM2: formData.get("surfaceHabitableM2")
        ? Number(formData.get("surfaceHabitableM2"))
        : null,
      anneeConstruction: formData.get("anneeConstruction")
        ? Number(formData.get("anneeConstruction"))
        : null,
    },
  });

  let statutId = (formData.get("statutId") as string) || "";
  if (!statutId) {
    const statutInitial = await prisma.dossierStatus.findUnique({ where: { key: "DEVIS_SIGNE" } });
    if (!statutInitial) throw new Error("Statut initial 'DEVIS_SIGNE' introuvable - lancez le seed.");
    statutId = statutInitial.id;
  }

  const dossier = await prisma.dossier.create({
    data: {
      reference: generateReference(),
      clientId: client.id,
      typeId: String(formData.get("typeId")),
      statutId,
      createdById,
      montantDevisTTC: eurosToCents(Number(formData.get("montantDevisTTC") || 0)),
      montantAideMPR: eurosToCents(Number(formData.get("montantAideMPR") || 0)),
      montantAideCEE: eurosToCents(Number(formData.get("montantAideCEE") || 0)),
      modePaiementAideId: (formData.get("modePaiementAideId") as string) || null,
      marId: (formData.get("marId") as string) || null,
      delegataireCeeId: (formData.get("delegataireCeeId") as string) || null,
      statutAnahId: (formData.get("statutAnahId") as string) || null,
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

  // Travaux prévus, saisis à la création (champs indexés travaux.N.champ)
  type LigneTravaux = {
    type?: string;
    quantite?: string;
    surfaceM2?: string;
    montantHT?: string;
    montantTTC?: string;
  };
  const travauxParLigne = new Map<number, LigneTravaux>();
  for (const [key, value] of formData.entries()) {
    const match = key.match(/^travaux\.(\d+)\.(type|quantite|surfaceM2|montantHT|montantTTC)$/);
    if (!match) continue;
    const index = Number(match[1]);
    const champ = match[2] as keyof LigneTravaux;
    if (!travauxParLigne.has(index)) travauxParLigne.set(index, {});
    travauxParLigne.get(index)![champ] = String(value);
  }
  for (const ligne of travauxParLigne.values()) {
    if (!ligne.type) continue;
    await prisma.dossierPosteTravaux.create({
      data: {
        dossierId: dossier.id,
        type: ligne.type as TypeTravaux,
        quantite: ligne.quantite ? Number(ligne.quantite) : null,
        surfaceM2: ligne.surfaceM2 ? Number(ligne.surfaceM2) : null,
        montantDevisHTCts: optionalEurosToCents(ligne.montantHT ?? null),
        montantDevisTTCCts: optionalEurosToCents(ligne.montantTTC ?? null),
      },
    });
  }

  revalidatePath("/dossiers");
  redirect(`/dossiers/${dossier.id}`);
}

export async function updateClientInfo(formData: FormData) {
  await requireAuth();
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
      surfaceHabitableM2: formData.get("surfaceHabitableM2")
        ? Number(formData.get("surfaceHabitableM2"))
        : null,
      anneeConstruction: formData.get("anneeConstruction")
        ? Number(formData.get("anneeConstruction"))
        : null,
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
  await requireAuth();
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
  await requireAuth();
  await prisma.dossier.update({ where: { id: dossierId }, data: { statutId } });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/dossiers");
  revalidatePath("/");
}

export async function updateAnahInfo(formData: FormData) {
  await requireAuth();
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
  await requireAuth();
  const dossierId = String(formData.get("dossierId"));
  await prisma.dossier.update({
    where: { id: dossierId },
    data: {
      montantEncaisseClient: eurosToCents(Number(formData.get("montantEncaisseClient") || 0)),
      montantEncaisseMPR: eurosToCents(Number(formData.get("montantEncaisseMPR") || 0)),
      montantEncaisseCEE: eurosToCents(Number(formData.get("montantEncaisseCEE") || 0)),
      delegataireCeeId: (formData.get("delegataireCeeId") as string) || null,
      dateDepotDelegataireCee: formData.get("dateDepotDelegataireCee")
        ? new Date(String(formData.get("dateDepotDelegataireCee")))
        : null,
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
  await requireAuth();
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
  await requireAuth();
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
  await requireAuth();
  await prisma.dossierPosteTravaux.delete({ where: { id: posteId } });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function uploadDocument(formData: FormData) {
  await requireAuth();
  const dossierId = String(formData.get("dossierId"));
  const file = formData.get("file") as File;
  if (!file || file.size === 0) return;

  // Le dossier doit exister en base avant toute écriture disque : dossierId
  // vient du client et ne doit jamais être utilisé tel quel comme segment
  // de chemin (risque de path traversal dans saveDocumentFile).
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");

  const saved = await saveDocumentFile(dossier.id, file);
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
  await requireAuth();
  const doc = await prisma.dossierDocument.findUnique({ where: { id: docId } });
  if (!doc) return;
  await deleteDocumentFile(doc.cheminFichier);
  await prisma.dossierDocument.delete({ where: { id: docId } });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function createTache(formData: FormData) {
  await requireAuth();
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
  await requireAuth();
  const tache = await prisma.tache.update({
    where: { id: tacheId },
    data: { statut: done ? "FAIT" : "A_FAIRE" },
  });
  revalidatePath(`/dossiers/${tache.dossierId}`);
  revalidatePath("/taches");
  revalidatePath("/");
}

export async function updateTache(tacheId: string, formData: FormData) {
  await requireAuth();
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
  await requireAuth();
  await prisma.tache.delete({ where: { id: tacheId } });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/taches");
  revalidatePath("/");
}
