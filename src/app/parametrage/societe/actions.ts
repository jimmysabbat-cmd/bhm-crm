"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireInternalUserContext } from "@/lib/authz";
import { chiffrerSecret, getEmailProviderForOrganisation, getOrgEmailSettings, avecSignature } from "@/lib/email/org-smtp";
import { activerEmailsAutomatiques, desactiverEmailsAutomatiques } from "@/lib/automations/activation";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const ctx = await requireInternalUserContext();
  if ((ctx.effectiveRole ?? ctx.role) !== "ADMIN") throw new Error("Accès réservé aux administrateurs.");
  return ctx;
}

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function enregistrerSocieteAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const emailFrom = txt(formData, "emailFrom");
    if (emailFrom && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailFrom)) throw new Error("Adresse d'envoi invalide.");
    const smtpPortRaw = txt(formData, "smtpPort");
    const smtpPort = smtpPortRaw ? Number(smtpPortRaw) : null;
    if (smtpPort != null && (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535)) throw new Error("Port SMTP invalide.");
    const motDePasse = String(formData.get("smtpPassword") ?? "");

    await prisma.organisation.update({
      where: { id: ctx.organisationId },
      data: {
        raisonSociale: txt(formData, "raisonSociale"),
        siret: txt(formData, "siret"),
        tva: txt(formData, "tva"),
        adresse: txt(formData, "adresse"),
        email: txt(formData, "email"),
        telephone: txt(formData, "telephone"),
        emailExpediteurNom: txt(formData, "emailExpediteurNom"),
        emailFrom,
        emailReplyTo: txt(formData, "emailReplyTo"),
        emailSignature: txt(formData, "emailSignature"),
        smtpHost: txt(formData, "smtpHost"),
        smtpPort,
        smtpSecure: formData.get("smtpSecure") === "on",
        smtpUser: txt(formData, "smtpUser"),
        // Champ vide = on garde le mot de passe déjà enregistré.
        ...(motDePasse ? { smtpPasswordChiffre: chiffrerSecret(motDePasse) } : {}),
        ...(formData.get("effacerMotDePasse") === "on" ? { smtpPasswordChiffre: null } : {}),
      },
    });
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Organisation", entityId: ctx.organisationId, action: "PARAMETRAGE_SOCIETE", metadata: { smtpModifie: Boolean(motDePasse) } });
    revalidatePath("/parametrage/societe");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function basculerEmailsAutoAction(activer: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    let message = "Emails automatiques désactivés : ils restent préparés en brouillon.";
    if (activer) {
      const r = await activerEmailsAutomatiques(ctx.organisationId);
      message = `Emails automatiques activés (${r.reglesActivees} règles). ${r.evenementsPassesIgnores} événement(s) antérieur(s) ignoré(s) pour ne pas relancer l'historique.`;
    } else {
      await desactiverEmailsAutomatiques(ctx.organisationId);
    }
    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Organisation", entityId: ctx.organisationId, action: activer ? "EMAILS_AUTO_ACTIVES" : "EMAILS_AUTO_DESACTIVES", metadata: {} });
    revalidatePath("/parametrage/societe");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function envoyerEmailTestAction(destinataire: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinataire)) throw new Error("Adresse de test invalide.");
    const [provider, settings, org] = await Promise.all([
      getEmailProviderForOrganisation(ctx.organisationId),
      getOrgEmailSettings(ctx.organisationId),
      prisma.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId }, select: { nom: true } }),
    ]);
    const res = await provider.sendEmail({
      to: destinataire,
      subject: `Test d'envoi - ${org.nom}`,
      body: avecSignature(`Bonjour,\n\nCeci est un email de test envoyé depuis le CRM pour vérifier la configuration d'envoi de ${org.nom}.`, settings.signature),
      replyTo: settings.replyTo,
    });
    if (!res.ok) throw new Error(res.error ?? "Échec de l'envoi.");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
