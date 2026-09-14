"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { envoyerChantierAction } from "../actions";

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const labelClass = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function NouvelleDemandeForm({ typeTravauxOptions }: { typeTravauxOptions: [string, string][] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="space-y-5"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const res = await envoyerChantierAction(formData);
          if (!res.ok) setError(res.error);
          else router.push(`/portail-do/${res.dossierId}`);
        })
      }
    >
      <div>
        <label className={labelClass}>Votre référence (optionnel)</label>
        <input name="referenceDonneurOrdre" className={inputClass} placeholder="Ex. votre numéro de commande interne" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Nom du client</label>
          <input name="clientNom" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Prénom du client</label>
          <input name="clientPrenom" required className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Téléphone</label>
          <input name="clientTelephone" type="tel" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input name="clientEmail" type="email" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Adresse</label>
        <input name="clientAdresse" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Code postal</label>
          <input name="clientCodePostal" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Ville</label>
          <input name="clientVille" className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Prestation</label>
          <select name="typeTravaux" required className={inputClass}>
            <option value="">Choisir...</option>
            {typeTravauxOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Surface (m²) / Quantité</label>
          <div className="mt-1 flex gap-2">
            <input name="surfaceM2" type="number" step="0.1" placeholder="Surface" className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="quantite" type="number" placeholder="Quantité" className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Date souhaitée</label>
        <input name="dateSouhaitee" type="date" className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Informations techniques / commentaires</label>
        <textarea name="infosTechniques" rows={3} className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Documents / photos</label>
        <input name="documents" type="file" multiple className={`${inputClass} py-1.5`} />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi..." : "Envoyer le chantier"}
        </Button>
      </div>
    </form>
  );
}
