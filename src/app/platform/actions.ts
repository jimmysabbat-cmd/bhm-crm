"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePlatformContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { createOrganisation, setOrganisationStatus } from "@/lib/platform/organisations";
import { setActiveTenantIdCookie, clearActiveTenantIdCookie, getActiveTenantIdCookie } from "@/lib/platform/tenant-context";
import { seedAutomations } from "../../../prisma/seed-automations";

// ============================================================
// Actions plateforme (P12, sections 14/15/16/17) - toutes réservées au
// PLATFORM SUPER ADMIN via requirePlatformContext() (jamais Role.ADMIN).
// ============================================================

export async function createOrganisationAction(formData: FormData): Promise<{ ok: true; organisationId: string } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    const nom = String(formData.get("nom") ?? "").trim();
    if (!nom) throw new Error("Le nom est obligatoire.");

    const organisationId = await createOrganisation({
      nom,
      raisonSociale: (formData.get("raisonSociale") as string) || null,
      siret: (formData.get("siret") as string) || null,
      tva: (formData.get("tva") as string) || null,
      adresse: (formData.get("adresse") as string) || null,
      email: (formData.get("email") as string) || null,
      telephone: (formData.get("telephone") as string) || null,
    });

    // createOrganisationFromTemplate (section 24) - périmètre P12 : clone
    // les automatisations/templates par défaut (P11) pour accélérer
    // l'onboarding. Le workflow/programme standard reste à extraire de
    // prisma/seed.ts vers une fonction réutilisable (limite documentée).
    if (formData.get("withTemplate") === "on") {
      await seedAutomations(prisma, organisationId);
    }

    await logAudit({ organisationId, userId: platform.userId, entityType: "Organisation", entityId: organisationId, action: "PLATFORM_ORGANISATION_CREEE", metadata: { nom } });

    revalidatePath("/platform/organisations");
    return { ok: true, organisationId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function setOrganisationStatusAction(organisationId: string, status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = await requirePlatformContext();
    await setOrganisationStatus(organisationId, status);
    await logAudit({ organisationId, userId: platform.userId, entityType: "Organisation", entityId: organisationId, action: `PLATFORM_ORGANISATION_${status}` });
    revalidatePath("/platform/organisations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** "Entrer dans <tenant>" (section 17) - jamais une identité usurpée : le PLATFORM SUPER ADMIN garde son propre compte, seul le contexte tenant change. */
export async function enterTenantAction(organisationId: string) {
  const platform = await requirePlatformContext();
  const org = await prisma.organisation.findFirst({ where: { id: organisationId }, select: { id: true } });
  if (!org) throw new Error("Organisation introuvable.");

  await setActiveTenantIdCookie(organisationId);
  await logAudit({ organisationId, userId: platform.userId, entityType: "Organisation", entityId: organisationId, action: "PLATFORM_TENANT_CONTEXT_ENTERED" });
  redirect("/");
}

/** "Sortir" (section 17/18) - retour au niveau plateforme, jamais un tenant implicite. */
export async function leaveTenantAction() {
  const platform = await requirePlatformContext();
  const organisationId = await getActiveTenantIdCookie();
  await clearActiveTenantIdCookie();
  if (organisationId) {
    await logAudit({ organisationId, userId: platform.userId, entityType: "Organisation", entityId: organisationId, action: "PLATFORM_TENANT_CONTEXT_LEFT" });
  }
  redirect("/platform");
}
