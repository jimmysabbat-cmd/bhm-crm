"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { saveDocumentFile } from "@/lib/documents";
import { createDemandeFromDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { logAudit } from "@/lib/audit";

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

    const surfaceRaw = formData.get("surfaceM2");
    const quantiteRaw = formData.get("quantite");
    const dateRaw = formData.get("dateSouhaitee");

    const { dossierId } = await createDemandeFromDonneurOrdre(ctx, {
      referenceDonneurOrdre: (formData.get("referenceDonneurOrdre") as string) || null,
      clientNom: String(formData.get("clientNom") ?? "").trim(),
      clientPrenom: String(formData.get("clientPrenom") ?? "").trim(),
      clientTelephone: (formData.get("clientTelephone") as string) || null,
      clientEmail: (formData.get("clientEmail") as string) || null,
      clientAdresse: (formData.get("clientAdresse") as string) || null,
      clientCodePostal: (formData.get("clientCodePostal") as string) || null,
      clientVille: (formData.get("clientVille") as string) || null,
      typeTravaux: String(formData.get("typeTravaux")),
      surfaceM2: surfaceRaw ? Number(surfaceRaw) : null,
      quantite: quantiteRaw ? Number(quantiteRaw) : null,
      infosTechniques: (formData.get("infosTechniques") as string) || null,
      dateSouhaitee: dateRaw ? new Date(String(dateRaw)) : null,
    });

    const files = formData.getAll("documents").filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of files) {
      const saved = await saveDocumentFile(dossierId, file);
      await prisma.dossierDocument.create({ data: { dossierId, type: "AUTRE", ...saved } });
    }

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
