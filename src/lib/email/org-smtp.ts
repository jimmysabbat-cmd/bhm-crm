import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { SMTPEmailProvider, getEmailProvider, type EmailProvider } from "./provider";

// ============================================================
// Configuration email PAR SOCIÉTÉ (tenant). Chaque organisation peut avoir
// son propre SMTP / expéditeur / signature ; sinon repli sur le SMTP global
// du serveur (variables d'environnement). Le mot de passe SMTP est chiffré
// en AES-256-GCM avec une clé dérivée d'AUTH_SECRET - jamais en clair en
// base, jamais renvoyé au navigateur.
// ============================================================

function key(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET manquant : impossible de chiffrer le mot de passe SMTP.");
  return createHash("sha256").update(`smtp:${secret}`).digest();
}

export function chiffrerSecret(clair: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(clair, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function dechiffrerSecret(chiffre: string): string {
  const [iv, tag, data] = chiffre.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export type OrgEmailSettings = {
  emailsAutoActifs: boolean;
  expediteur: string | null; // "Nom <adresse>" prêt pour l'en-tête From
  replyTo: string | null;
  signature: string | null;
  smtpPropre: boolean;
};

export async function getOrgEmailSettings(organisationId: string): Promise<OrgEmailSettings> {
  const o = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { nom: true, emailsAutoActifs: true, emailExpediteurNom: true, emailFrom: true, emailReplyTo: true, emailSignature: true, smtpHost: true },
  });
  if (!o) throw new Error("Organisation introuvable.");
  const nom = (o.emailExpediteurNom || o.nom).replace(/[<>"]/g, "");
  return {
    emailsAutoActifs: o.emailsAutoActifs,
    expediteur: o.emailFrom ? `"${nom}" <${o.emailFrom}>` : null,
    replyTo: o.emailReplyTo,
    signature: o.emailSignature,
    smtpPropre: Boolean(o.smtpHost && o.emailFrom),
  };
}

/**
 * Fournisseur à utiliser pour CETTE société : son SMTP propre s'il est
 * configuré, sinon le fournisseur global (SMTP d'environnement si
 * EMAIL_SEND_ENABLED=true, sinon aucun envoi réel).
 */
export async function getEmailProviderForOrganisation(organisationId: string): Promise<EmailProvider> {
  const o = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { nom: true, emailExpediteurNom: true, emailFrom: true, smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, smtpPasswordChiffre: true },
  });
  if (o?.smtpHost && o.emailFrom) {
    const nom = (o.emailExpediteurNom || o.nom).replace(/[<>"]/g, "");
    return new SMTPEmailProvider(
      {
        host: o.smtpHost,
        port: o.smtpPort ?? 587,
        user: o.smtpUser ?? undefined,
        pass: o.smtpPasswordChiffre ? dechiffrerSecret(o.smtpPasswordChiffre) : undefined,
        from: `"${nom}" <${o.emailFrom}>`,
        secure: o.smtpSecure,
      },
      { alwaysEnabled: true }
    );
  }
  return getEmailProvider();
}

/** Ajoute la signature de la société au corps (une seule fois). */
export function avecSignature(corps: string, signature: string | null): string {
  if (!signature?.trim()) return corps;
  if (corps.includes(signature.trim())) return corps;
  return `${corps.trimEnd()}\n\n--\n${signature.trim()}`;
}
