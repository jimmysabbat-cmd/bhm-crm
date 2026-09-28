"use server";

import { revalidatePath } from "next/cache";
import { requireInternalUserContext, hasPermission } from "@/lib/authz";
import { pointerPaiement } from "@/lib/tresorerie";
import { logAudit } from "@/lib/audit";
import type { ModeReglement } from "@/generated/prisma/enums";

const MODES: ModeReglement[] = ["VIREMENT", "CHEQUE", "CB", "ESPECES", "PRELEVEMENT", "AIDE", "MANDATAIRE", "AUTRE"];

// Pointage d'un paiement réel (reçu ou versé), éventuellement réparti sur
// plusieurs dossiers - typiquement un virement groupé ANAH ou délégataire
// CEE. Chaque affectation est appliquée séparément : en cas d'erreur sur
// une ligne, les précédentes restent enregistrées et l'erreur le signale.
export async function pointerPaiementsAction(input: {
  date: string;
  mode: string;
  reference: string;
  affectations: { ligneId: string; montantCts: number }[];
}): Promise<{ ok: true; nb: number } | { ok: false; error: string; nbAppliquees: number }> {
  let nb = 0;
  try {
    const ctx = await requireInternalUserContext();
    if (!hasPermission(ctx, "MANAGE_FINANCES")) throw new Error("Accès réservé à la direction / comptabilité.");
    const date = new Date(`${input.date}T12:00:00`);
    if (!input.date || Number.isNaN(date.getTime())) throw new Error("Date du paiement requise.");
    const mode = MODES.includes(input.mode as ModeReglement) ? (input.mode as ModeReglement) : "VIREMENT";
    const affectations = input.affectations.filter((a) => a.montantCts > 0);
    if (affectations.length === 0) throw new Error("Aucun montant à affecter.");

    for (const a of affectations) {
      const { dossierId, mouvementId } = await pointerPaiement({
        organisationId: ctx.organisationId,
        userId: ctx.userId,
        ligneId: a.ligneId,
        montantCts: Math.round(a.montantCts),
        date,
        mode,
        reference: input.reference.trim() || null,
      });
      await logAudit({
        organisationId: ctx.organisationId,
        userId: ctx.userId,
        entityType: "MouvementFinancier",
        entityId: mouvementId,
        action: "POINTAGE_PAIEMENT",
        metadata: { montantCts: a.montantCts, date: input.date, mode, reference: input.reference },
      });
      revalidatePath(`/dossiers/${dossierId}`);
      nb += 1;
    }
    revalidatePath("/finances/tresorerie");
    revalidatePath("/finances");
    return { ok: true, nb };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue.", nbAppliquees: nb };
  }
}
