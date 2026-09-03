"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { calculateCeeCumac, getDossierEngagementDate, validateOverrideReason } from "@/lib/reglementaire/engine";
import type { Prisma } from "@/generated/prisma/client";
import type { StatutEligibiliteReglementaire } from "@/generated/prisma/enums";

async function loadOwnedDossier(dossierId: string, organisationId: string) {
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, organisationId },
    select: { id: true, dateSignatureDevis: true },
  });
  if (!dossier) throw new Error("Dossier introuvable.");
  return dossier;
}

function inputsFromFormData(formData: FormData): Record<string, unknown> {
  const zoneClimatique = formData.get("zoneClimatique");
  const surfaceChauffeeM2 = formData.get("surfaceChauffeeM2");
  const etasBande = formData.get("etasBande");
  return {
    zoneClimatique: zoneClimatique && String(zoneClimatique).trim() !== "" ? String(zoneClimatique) : null,
    surfaceChauffeeM2: surfaceChauffeeM2 && String(surfaceChauffeeM2).trim() !== "" ? Number(surfaceChauffeeM2) : null,
    etasBande: etasBande && String(etasBande).trim() !== "" ? String(etasBande) : null,
  };
}

/**
 * Calcule et enregistre un CalculReglementaire (section 10/11 du prompt
 * P7) - SIMULATION ou OFFICIEL selon le formulaire. Refuse d'enregistrer si
 * aucune version réglementaire n'a pu être résolue (date d'engagement
 * manquante ou hors période) : on ne crée jamais une trace sans version
 * valide à laquelle l'attacher. Un calcul OFFICIEL rattaché à un poste de
 * travaux devient le calcul actif de ce poste (le pointeur bouge, l'ancien
 * calcul reste intact dans l'historique - jamais écrasé, section 11).
 */
export async function calculerReglementaireDossier(formData: FormData) {
  const ctx = await requireUserContext();
  const dossierId = String(formData.get("dossierId"));
  const dossier = await loadOwnedDossier(dossierId, ctx.organisationId);

  const posteTravauxIdRaw = formData.get("posteTravauxId");
  const posteTravauxId = posteTravauxIdRaw && String(posteTravauxIdRaw).trim() !== "" ? String(posteTravauxIdRaw) : null;
  if (posteTravauxId) {
    const poste = await prisma.dossierPosteTravaux.findFirst({ where: { id: posteTravauxId, dossierId } });
    if (!poste) throw new Error("Poste de travaux introuvable.");
  }

  const ficheCode = String(formData.get("ficheCode") ?? "BAR-TH-171");
  const type = String(formData.get("type")) === "OFFICIEL" ? "OFFICIEL" : "SIMULATION";
  const inputs = inputsFromFormData(formData);
  const dateEngagement = getDossierEngagementDate(dossier);

  const result = await calculateCeeCumac({ ficheCode, dateEngagement, inputs });

  if (!result.ruleVersionId) {
    throw new Error(
      "Impossible d'enregistrer ce calcul : aucune version réglementaire applicable n'a été trouvée (date d'engagement manquante ou hors période). Renseignez la date de signature du devis."
    );
  }

  const calcul = await prisma.calculReglementaire.create({
    data: {
      organisationId: ctx.organisationId,
      dossierId,
      posteTravauxId,
      ruleVersionId: result.ruleVersionId,
      type,
      dateEngagement: dateEngagement!,
      inputs: inputs as Prisma.InputJsonValue,
      resultat: { reasons: result.reasons, warnings: result.warnings, missingFields: result.missingFields, provenance: result.provenance } as Prisma.InputJsonValue,
      kwhCumac: result.kwhCumac,
      statutEligibilite: result.statutEligibilite,
      createdById: ctx.userId,
    },
  });

  if (type === "OFFICIEL" && posteTravauxId) {
    await prisma.dossierPosteTravaux.update({
      where: { id: posteTravauxId },
      data: { ficheReglementaireCode: ficheCode, calculReglementaireActifId: calcul.id },
    });
  }

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "CalculReglementaire",
    entityId: calcul.id,
    action: type === "OFFICIEL" ? "CALCUL_OFFICIEL_ENREGISTRE" : "CALCUL_SIMULATION_ENREGISTRE",
    metadata: { dossierId, posteTravauxId: posteTravauxId ?? null, ficheCode, kwhCumac: result.kwhCumac ?? 0, statutEligibilite: result.statutEligibilite },
  });

  revalidatePath(`/dossiers/${dossierId}`);
}

/**
 * Override manuel (section 24) - ne modifie JAMAIS la règle ni le calcul
 * initial : ajoute une correction visible sur CE calcul précis, avec une
 * raison obligatoire (section 23/29). Réservé à MANAGE_REGLEMENTATION.
 */
export async function overrideCalculReglementaire(calculId: string, formData: FormData) {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "MANAGE_REGLEMENTATION")) {
    throw new Error("Accès refusé : l'override d'un calcul réglementaire est réservé à la direction.");
  }

  const calcul = await prisma.calculReglementaire.findFirst({ where: { id: calculId, organisationId: ctx.organisationId } });
  if (!calcul) throw new Error("Calcul réglementaire introuvable.");

  const reason = validateOverrideReason(String(formData.get("overrideReason") ?? ""));

  const overrideStatutRaw = formData.get("overrideStatutEligibilite");
  const overrideStatutEligibilite = overrideStatutRaw && String(overrideStatutRaw).trim() !== "" ? (String(overrideStatutRaw) as StatutEligibiliteReglementaire) : null;
  const overrideKwhCumacRaw = formData.get("overrideKwhCumac");
  const overrideKwhCumac = overrideKwhCumacRaw && String(overrideKwhCumacRaw).trim() !== "" ? Number(overrideKwhCumacRaw) : null;

  await prisma.calculReglementaire.update({
    where: { id: calcul.id },
    data: {
      overrideStatutEligibilite,
      overrideKwhCumac,
      overrideReason: reason,
      overrideById: ctx.userId,
      overrideAt: new Date(),
    },
  });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "CalculReglementaire",
    entityId: calcul.id,
    action: "OVERRIDE",
    metadata: {
      dossierId: calcul.dossierId,
      overrideReason: reason,
      overrideStatutEligibilite: overrideStatutEligibilite ?? "",
      overrideKwhCumac: overrideKwhCumac ?? 0,
    },
  });

  revalidatePath(`/dossiers/${calcul.dossierId}`);
}
