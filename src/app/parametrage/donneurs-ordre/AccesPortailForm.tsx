"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { smallInputClass, labelClass } from "@/components/ui/field";
import { creerAccesDonneurOrdreAction } from "../actions";

// Création (ou renouvellement) de l'accès au portail donneur d'ordre. Aucun
// email n'est envoyé automatiquement : le lien s'affiche pour être copié et
// transmis au DO (SMS, WhatsApp, email perso...).
export function AccesPortailForm({
  donneurOrdreId,
  defaultEmail,
  comptes,
}: {
  donneurOrdreId: string;
  defaultEmail: string | null;
  comptes: { id: string; name: string; email: string; actif: boolean; lastLoginAt: Date | null }[];
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function generer(targetEmail: string, targetName: string) {
    startTransition(async () => {
      setError(null);
      setLink(null);
      setCopied(false);
      const res = await creerAccesDonneurOrdreAction(donneurOrdreId, { name: targetName, email: targetEmail });
      if (!res.ok) setError(res.error);
      else setLink(res.link);
    });
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accès au portail</div>
      {comptes.length > 0 && (
        <ul className="space-y-1 text-sm text-slate-600">
          {comptes.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <span>
                {c.name} · {c.email}
                {!c.actif && " (désactivé)"}
                <span className="ml-2 text-xs text-slate-400">
                  {c.lastLoginAt ? `dernière connexion ${c.lastLoginAt.toLocaleDateString("fr-FR")}` : "jamais connecté"}
                </span>
              </span>
              <button type="button" disabled={pending} onClick={() => generer(c.email, c.name)} className="text-xs font-medium text-emerald-700 hover:underline">
                Nouveau lien de connexion
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className={labelClass}>Nom de la personne</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={smallInputClass} placeholder="Ex. Marie Dupont" />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Email de connexion</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={smallInputClass} />
        </div>
        <div className="flex items-end">
          <Button type="button" className="text-xs" disabled={pending || !email.trim()} onClick={() => generer(email, name)}>
            Créer l&apos;accès portail
          </Button>
        </div>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {link && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div>Lien à transmettre au donneur d&apos;ordre (valable 7 jours) : il y choisit son mot de passe puis se connecte avec son email.</div>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={link} className="w-full rounded border border-emerald-200 bg-white px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copié" : "Copier"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
