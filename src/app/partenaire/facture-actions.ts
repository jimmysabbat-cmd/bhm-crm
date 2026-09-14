"use server";

import { revalidatePath } from "next/cache";
import { requireUserContext } from "@/lib/authz";
import { eurosToCents } from "@/lib/money";
import { deposerFactureSousTraitant } from "@/lib/facturation/mutations";

// ============================================================
// P16 - dépôt d'une facture par un sous-traitant, dans son propre espace
// partenaire. Un sous-traitant ne peut déposer une facture QUE sur une
// mission qui lui a été explicitement destinée et marquée TERMINEE (contrôle
// fait dans deposerFactureSousTraitant, réutilisé et testé indépendamment,
// cf. scripts/test-p16-facturation.ts).
// ============================================================

export async function deposerFactureSousTraitantAction(formData: FormData) {
  const ctx = await requireUserContext();
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) throw new Error("Action réservée aux sous-traitants.");

  const packageId = String(formData.get("packageId") ?? "");
  const numero = String(formData.get("numero") ?? "").trim();
  const montantHTEuros = Number(formData.get("montantHT"));
  const tauxTVA = Number(formData.get("tauxTVA"));
  const file = formData.get("file") as File | null;

  await deposerFactureSousTraitant({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    sousTraitantId: ctx.sousTraitantId,
    packageId,
    numero,
    montantHTCts: eurosToCents(montantHTEuros),
    tauxTVA,
    file: file && file.size > 0 ? file : null,
  });

  revalidatePath("/partenaire");
}
