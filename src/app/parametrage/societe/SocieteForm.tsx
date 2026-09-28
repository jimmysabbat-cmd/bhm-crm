"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { enregistrerSocieteAction, basculerEmailsAutoAction, envoyerEmailTestAction } from "./actions";

type Societe = {
  nom: string;
  raisonSociale: string | null;
  siret: string | null;
  tva: string | null;
  adresse: string | null;
  email: string | null;
  telephone: string | null;
  emailsAutoActifs: boolean;
  emailExpediteurNom: string | null;
  emailFrom: string | null;
  emailReplyTo: string | null;
  emailSignature: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  motDePasseEnregistre: boolean;
};

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function SocieteForm({ societe, smtpServeurDisponible, emailUtilisateur }: { societe: Societe; smtpServeurDisponible: boolean; emailUtilisateur: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState(emailUtilisateur);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, succes: string) =>
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? succes } : { ok: false, text: r.error ?? "Erreur." });
      if (r.ok) router.refresh();
    });

  const envoiPossible = Boolean(societe.smtpHost && societe.emailFrom) || smtpServeurDisponible;

  return (
    <div className="space-y-6">
      <section className={`rounded-2xl border p-5 ${societe.emailsAutoActifs ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Emails automatiques de {societe.nom}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {societe.emailsAutoActifs
                ? "Activés : les emails aux donneurs d'ordre, sous-traitants et délégataires partent automatiquement (accusés de réception, missions, relances de factures et de primes CEE)."
                : "Désactivés : les emails sont préparés en brouillon mais jamais envoyés."}
            </p>
            {!envoiPossible && <p className="mt-1 text-xs text-amber-800">Configurez d&apos;abord l&apos;envoi ci-dessous (serveur SMTP de la société).</p>}
          </div>
          <Button
            type="button"
            variant={societe.emailsAutoActifs ? "secondary" : "primary"}
            disabled={pending || (!societe.emailsAutoActifs && !envoiPossible)}
            onClick={() => run(() => basculerEmailsAutoAction(!societe.emailsAutoActifs), "")}
          >
            {societe.emailsAutoActifs ? "Désactiver" : "Activer les emails automatiques"}
          </Button>
        </div>
      </section>

      <form
        className="space-y-6"
        action={(fd) => run(() => enregistrerSocieteAction(fd), "Paramètres enregistrés.")}
      >
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Coordonnées</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className={label}>Raison sociale<input name="raisonSociale" defaultValue={societe.raisonSociale ?? ""} className={input} /></label>
            <label className={label}>SIRET<input name="siret" defaultValue={societe.siret ?? ""} className={input} /></label>
            <label className={label}>N° TVA<input name="tva" defaultValue={societe.tva ?? ""} className={input} /></label>
            <label className={`${label} sm:col-span-3`}>Adresse<input name="adresse" defaultValue={societe.adresse ?? ""} className={input} /></label>
            <label className={label}>Email de contact<input name="email" type="email" defaultValue={societe.email ?? ""} className={input} /></label>
            <label className={label}>Téléphone<input name="telephone" defaultValue={societe.telephone ?? ""} className={input} /></label>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Envoi des emails</h2>
            <p className="mt-1 text-xs text-slate-500">
              Chaque société envoie depuis sa propre adresse. Pour une boîte o2switch : serveur <code>mail.votre-domaine.fr</code>, port 465 avec SSL (ou 587 sans), identifiant = l&apos;adresse email complète.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className={label}>Nom de l&apos;expéditeur<input name="emailExpediteurNom" defaultValue={societe.emailExpediteurNom ?? ""} placeholder={societe.nom} className={input} /></label>
            <label className={label}>Adresse d&apos;envoi<input name="emailFrom" type="email" defaultValue={societe.emailFrom ?? ""} placeholder="contact@votre-domaine.fr" className={input} /></label>
            <label className={label}>Adresse de réponse<input name="emailReplyTo" type="email" defaultValue={societe.emailReplyTo ?? ""} className={input} /></label>
            <label className={label}>Serveur SMTP<input name="smtpHost" defaultValue={societe.smtpHost ?? ""} placeholder="mail.votre-domaine.fr" className={input} /></label>
            <label className={label}>Port<input name="smtpPort" type="number" defaultValue={societe.smtpPort ?? ""} placeholder="465" className={input} /></label>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" name="smtpSecure" defaultChecked={societe.smtpSecure} /> Connexion SSL (port 465)
            </label>
            <label className={label}>Identifiant SMTP<input name="smtpUser" defaultValue={societe.smtpUser ?? ""} className={input} autoComplete="off" /></label>
            <label className={label}>
              Mot de passe SMTP
              <input name="smtpPassword" type="password" placeholder={societe.motDePasseEnregistre ? "•••••••• (enregistré)" : ""} className={input} autoComplete="new-password" />
            </label>
            {societe.motDePasseEnregistre && (
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
                <input type="checkbox" name="effacerMotDePasse" /> Effacer le mot de passe
              </label>
            )}
            <label className={`${label} sm:col-span-3`}>
              Signature ajoutée à chaque email
              <textarea name="emailSignature" rows={4} defaultValue={societe.emailSignature ?? ""} className={input} />
            </label>
          </div>
        </section>

        <Button type="submit" disabled={pending}>
          Enregistrer
        </Button>
      </form>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <label className={`${label} min-w-64 flex-1`}>
          Envoyer un email de test à
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} type="email" className={input} />
        </label>
        <Button type="button" variant="secondary" disabled={pending || !envoiPossible} onClick={() => run(() => envoyerEmailTestAction(testTo), `Email de test envoyé à ${testTo}.`)}>
          Envoyer le test
        </Button>
      </section>

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
