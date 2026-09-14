"use server";

import { revalidatePath } from "next/cache";
import { requireUserContext, assertDossierInOrg } from "@/lib/authz";
import { creerFactureDonneurOrdre, emettreFactureDonneurOrdre, annulerFacture, validerFactureSousTraitant } from "@/lib/facturation/mutations";

// ============================================================
// P16 - Server Actions de facturation côté interne (BHM/RUA). Chaque action
// ne fait que résoudre le contexte utilisateur puis déléguer à
// src/lib/facturation/mutations.ts (logique testable indépendamment d'une
// session, cf. scripts/test-p16-facturation.ts) - même principe que
// envoyerEnMissionAction / createMissionPackage.
// ============================================================

export async function creerFactureDonneurOrdreAction(formData: FormData) {
  const ctx = await requireUserContext();
  const dossierId = String(formData.get("dossierId"));
  await assertDossierInOrg(dossierId, ctx.organisationId);
  const posteIds = formData.getAll("posteIds").map(String);

  const dateEcheanceRaw = formData.get("dateEcheance");
  const dateEcheance = dateEcheanceRaw && String(dateEcheanceRaw).trim() !== "" ? new Date(String(dateEcheanceRaw)) : null;

  await creerFactureDonneurOrdre({ organisationId: ctx.organisationId, userId: ctx.userId, dossierId, posteIds, dateEcheance });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function emettreFactureDonneurOrdreAction(factureId: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await emettreFactureDonneurOrdre({ organisationId: ctx.organisationId, userId: ctx.userId, factureId });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function annulerFactureAction(factureId: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await annulerFacture({ organisationId: ctx.organisationId, userId: ctx.userId, factureId });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function validerFactureSousTraitantAction(factureId: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await validerFactureSousTraitant({ organisationId: ctx.organisationId, userId: ctx.userId, factureId });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/finances");
}
