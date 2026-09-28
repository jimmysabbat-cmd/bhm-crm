"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { saveDocumentFile } from "@/lib/documents";
import { createDemandeFromDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";

const MAX_FICHIER_OCTETS = 10 * 1024 * 1024;
const MAX_TOTAL_OCTETS = 25 * 1024 * 1024;
const MIME_AUTORISES = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.ms-excel$|text\/plain$)/;

// Validé AVANT toute écriture : un fichier refusé ne doit jamais laisser un
// dossier à moitié créé (le DO réessaierait et créerait un doublon).
function validerFichiers(files: File[]): void {
  let total = 0;
  for (const f of files) {
    if (f.size > MAX_FICHIER_OCTETS) throw new Error(`« ${f.name} » dépasse 10 Mo.`);
    if (f.type && !MIME_AUTORISES.test(f.type)) throw new Error(`« ${f.name} » : format non accepté (photos, PDF, Word, Excel).`);
    total += f.size;
  }
  if (total > MAX_TOTAL_OCTETS) throw new Error("Pièces jointes trop lourdes (25 Mo maximum au total).");
}

// ============================================================
// P16 - "Envoyer un chantier" : alimente directement Client/Dossier/
// DossierPosteTravaux (cf. src/lib/donneurs-ordre/access.ts), jamais de
// copie parallèle. Les documents/photos jointes réutilisent exactement le
// stockage DossierDocument existant (saveDocumentFile).
// ============================================================

export async function envoyerChantierAction(formData: FormData): Promise<{ ok: true; dossierId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (ctx.role !== "DONNEUR_ORDRE") throw new Error("Accès refusé.");

    const clientNom = String(formData.get("clientNom") ?? "").trim();
    const clientPrenom = String(formData.get("clientPrenom") ?? "").trim();
    const typeTravaux = String(formData.get("typeTravaux") ?? "").trim();
    if (!clientNom || !clientPrenom) throw new Error("Nom et prénom du client requis.");
    if (!typeTravaux) throw new Error("Type de prestation requis.");

    const files = formData.getAll("documents").filter((f): f is File => f instanceof File && f.size > 0);
    validerFichiers(files);

    const surfaceRaw = formData.get("surfaceM2");
    const quantiteRaw = formData.get("quantite");
    const dateRaw = formData.get("dateSouhaitee");
    const surfaceM2 = surfaceRaw ? Number(surfaceRaw) : null;
    const quantite = quantiteRaw ? Number(quantiteRaw) : null;
    if ((surfaceM2 != null && (!Number.isFinite(surfaceM2) || surfaceM2 < 0)) || (quantite != null && (!Number.isFinite(quantite) || quantite < 0))) {
      throw new Error("Surface ou quantité invalide.");
    }

    const { dossierId } = await createDemandeFromDonneurOrdre(ctx, {
      referenceDonneurOrdre: (formData.get("referenceDonneurOrdre") as string) || null,
      clientNom,
      clientPrenom,
      clientTelephone: (formData.get("clientTelephone") as string) || null,
      clientEmail: (formData.get("clientEmail") as string) || null,
      clientAdresse: (formData.get("clientAdresse") as string) || null,
      clientCodePostal: (formData.get("clientCodePostal") as string) || null,
      clientVille: (formData.get("clientVille") as string) || null,
      typeTravaux,
      surfaceM2,
      quantite,
      infosTechniques: (formData.get("infosTechniques") as string) || null,
      dateSouhaitee: dateRaw ? new Date(String(dateRaw)) : null,
    });

    try {
      for (const file of files) {
        const saved = await saveDocumentFile(dossierId, file);
        await prisma.dossierDocument.create({ data: { dossierId, type: "AUTRE", createdById: ctx.userId, ...saved } });
      }
    } catch (e) {
      // Échec de stockage : on retire la demande pour que le DO puisse
      // simplement renvoyer le formulaire sans créer de doublon.
      const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientId: true, documents: { select: { cheminFichier: true } } } });
      await prisma.dossier.delete({ where: { id: dossierId } }).catch(() => undefined);
      if (dossier) await prisma.client.delete({ where: { id: dossier.clientId } }).catch(() => undefined);
      throw new Error(`Envoi des pièces jointes impossible, demande non enregistrée. Réessayez. (${e instanceof Error ? e.message : "erreur"})`);
    }

    await notifierEquipeNouvelleDemande(ctx.organisationId, dossierId, ctx.donneurOrdreId ?? null, `${clientPrenom} ${clientNom}`);

    await logAudit({
      organisationId: ctx.organisationId,
      userId: ctx.userId,
      entityType: "Dossier",
      entityId: dossierId,
      action: "CHANTIER_ENVOYE_DONNEUR_ORDRE",
      metadata: { donneurOrdreId: ctx.donneurOrdreId ?? "" },
    });

    revalidatePath("/portail-do");
    revalidatePath("/portail-do/mes-demandes");
    return { ok: true, dossierId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

// P16 - réponse du donneur d'ordre à une demande de complément (déclenche
// DO_COMPLEMENT_RECU côté interne). Toujours vérifié que CE dossier
// appartient bien à SON donneurOrdreId (jamais un autre) et qu'un
// complément est réellement en attente.
export async function repondreComplementAction(dossierId: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (ctx.role !== "DONNEUR_ORDRE" || !ctx.donneurOrdreId) throw new Error("Accès refusé.");
    if (!message.trim()) throw new Error("Message requis.");

    const dossier = await prisma.dossier.findFirst({
      where: { id: dossierId, donneurOrdreId: ctx.donneurOrdreId, organisationId: ctx.organisationId, complementDemandeMessage: { not: null }, complementReponseMessage: null },
    });
    if (!dossier) throw new Error("Aucun complément en attente pour cette demande.");

    await prisma.dossier.update({ where: { id: dossierId }, data: { complementReponseMessage: message.trim(), complementReponseAt: new Date() } });

    revalidatePath(`/portail-do/${dossierId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

// Alerte directe de l'équipe interne (admins + administratif) sans dépendre
// du cron des automatisations : une nouvelle demande DO ne doit jamais
// passer inaperçue. Best-effort : n'empêche jamais l'enregistrement.
async function notifierEquipeNouvelleDemande(organisationId: string, dossierId: string, donneurOrdreId: string | null, clientLabel: string) {
  try {
    const [destinataires, donneur] = await Promise.all([
      prisma.user.findMany({ where: { organisationId, actif: true, role: { in: ["ADMIN", "ADMINISTRATIF"] } }, select: { id: true } }),
      donneurOrdreId ? prisma.donneurOrdre.findUnique({ where: { id: donneurOrdreId }, select: { nom: true } }) : null,
    ]);
    for (const u of destinataires) {
      await createNotification({
        userId: u.id,
        organisationId,
        type: "DO_NOUVELLE_DEMANDE",
        title: "Nouvelle demande donneur d'ordre",
        message: `${donneur?.nom ?? "Un donneur d'ordre"} a envoyé un chantier pour ${clientLabel}.`,
        entityType: "Dossier",
        entityId: dossierId,
      });
    }
  } catch {
    // best-effort volontaire
  }
}
