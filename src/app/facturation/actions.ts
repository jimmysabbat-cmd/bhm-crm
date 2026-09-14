"use server";

import { revalidatePath } from "next/cache";
import { requireUserContext, assertDossierInOrg } from "@/lib/authz";
import { eurosToCents } from "@/lib/money";
import {
  creerFactureDonneurOrdre,
  emettreFactureDonneurOrdre,
  annulerFacture,
  validerFactureSousTraitant,
  refuserFactureSousTraitant,
  creerFactureManuelle,
  transmettreFacture,
  changerStatutFacture,
  ajouterReglementFacture,
  supprimerReglementFacture,
} from "@/lib/facturation/mutations";
import type { TypeFacture, StatutFacture, ModeReglement } from "@/generated/prisma/enums";

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

export async function refuserFactureSousTraitantAction(factureId: string, motif: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await refuserFactureSousTraitant({ organisationId: ctx.organisationId, userId: ctx.userId, factureId, motif: motif || null });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/finances");
}

function optionalEuros(formData: FormData, field: string): number {
  const raw = formData.get(field);
  if (!raw || String(raw).trim() === "") return 0;
  return eurosToCents(Number(raw));
}

function optionalDate(formData: FormData, field: string): Date | null {
  const raw = formData.get(field);
  if (!raw || String(raw).trim() === "") return null;
  return new Date(String(raw));
}

/**
 * Dépôt manuel MVP (section "AJOUT PRIORITAIRE - FACTURATION MVP") : couvre
 * CLIENT/DONNEUR_ORDRE/SOUS_TRAITANT depuis l'interne, avec PDF externe et
 * reprise éventuelle (statutInitial + montant déjà réglé) - jamais de
 * génération automatique ici (cf. src/lib/facturation/pdf.ts pour le
 * chemin avancé, conservé mais non utilisé par ce formulaire).
 */
export async function creerFactureManuelleAction(formData: FormData) {
  const ctx = await requireUserContext();
  const dossierId = String(formData.get("dossierId"));
  await assertDossierInOrg(dossierId, ctx.organisationId);

  const statutInitialRaw = String(formData.get("statutInitial") ?? "");
  const file = formData.get("file") as File | null;

  await creerFactureManuelle({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    dossierId,
    type: String(formData.get("type")) as TypeFacture,
    posteTravauxId: String(formData.get("posteTravauxId") ?? "") || null,
    sousTraitantId: String(formData.get("sousTraitantId") ?? "") || null,
    numero: String(formData.get("numero") ?? ""),
    dateFacture: optionalDate(formData, "dateFacture") ?? new Date(),
    dateEcheance: optionalDate(formData, "dateEcheance"),
    montantHTCts: optionalEuros(formData, "montantHT"),
    tauxTVA: Number(formData.get("tauxTVA") ?? 0.2),
    commentaire: String(formData.get("commentaire") ?? "") || null,
    file: file && file.size > 0 ? file : null,
    statutInitial: (statutInitialRaw || null) as StatutFacture | null,
    montantDejaRegleCts: optionalEuros(formData, "montantDejaRegle"),
    reglementDate: optionalDate(formData, "reglementDate"),
    reglementMode: (String(formData.get("reglementMode") ?? "") || null) as ModeReglement | null,
    reglementReference: String(formData.get("reglementReference") ?? "") || null,
  });

  revalidatePath(`/dossiers/${dossierId}`);
}

export async function transmettreFactureAction(factureId: string, destinataire: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await transmettreFacture({ organisationId: ctx.organisationId, userId: ctx.userId, factureId, destinataire });
  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/portail-do/factures");
}

export async function changerStatutFactureAction(factureId: string, statut: StatutFacture) {
  const ctx = await requireUserContext();
  const { dossierId } = await changerStatutFacture({ organisationId: ctx.organisationId, userId: ctx.userId, factureId, statut });
  revalidatePath(`/dossiers/${dossierId}`);
}

export async function ajouterReglementFactureAction(formData: FormData) {
  const ctx = await requireUserContext();
  const factureId = String(formData.get("factureId"));

  const { dossierId } = await ajouterReglementFacture({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    factureId,
    montantCts: optionalEuros(formData, "montant"),
    date: optionalDate(formData, "date") ?? new Date(),
    mode: String(formData.get("mode")) as ModeReglement,
    reference: String(formData.get("reference") ?? "") || null,
    commentaire: String(formData.get("commentaire") ?? "") || null,
  });

  revalidatePath(`/dossiers/${dossierId}`);
  revalidatePath("/portail-do/factures");
}

export async function supprimerReglementFactureAction(reglementId: string) {
  const ctx = await requireUserContext();
  const { dossierId } = await supprimerReglementFacture({ organisationId: ctx.organisationId, userId: ctx.userId, reglementId });
  revalidatePath(`/dossiers/${dossierId}`);
}
