import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { isEmailSendEnabled } from "@/lib/email/provider";
import { SocieteForm } from "./SocieteForm";

export default async function SocietePage() {
  const ctx = await requireUserContext();
  if (isPartnerRole(ctx) || (ctx.effectiveRole ?? ctx.role) !== "ADMIN") redirect("/parametrage");
  const [o, user] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
  ]);
  return (
    <SocieteForm
      societe={{
        nom: o.nom,
        raisonSociale: o.raisonSociale,
        siret: o.siret,
        tva: o.tva,
        adresse: o.adresse,
        email: o.email,
        telephone: o.telephone,
        emailsAutoActifs: o.emailsAutoActifs,
        emailExpediteurNom: o.emailExpediteurNom,
        emailFrom: o.emailFrom,
        emailReplyTo: o.emailReplyTo,
        emailSignature: o.emailSignature,
        smtpHost: o.smtpHost,
        smtpPort: o.smtpPort,
        smtpSecure: o.smtpSecure,
        smtpUser: o.smtpUser,
        motDePasseEnregistre: Boolean(o.smtpPasswordChiffre),
      }}
      smtpServeurDisponible={isEmailSendEnabled() && Boolean(process.env.SMTP_HOST)}
      emailUtilisateur={user?.email ?? ""}
    />
  );
}
