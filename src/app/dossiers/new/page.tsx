import { createDossier } from "../actions";
import {
  modePaiementLabels,
  precariteLabels,
  typeDossierLabels,
} from "@/lib/dossier-labels";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const labelClass = "text-sm font-medium text-neutral-700";

export default function NewDossierPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Nouveau dossier</h1>

      <form action={createDossier} className="space-y-6">
        <fieldset className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <legend className="px-1 text-sm font-medium text-neutral-900">Client</legend>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={labelClass}>Prénom</label>
              <input name="prenom" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Nom</label>
              <input name="nom" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Email</label>
              <input name="email" type="email" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Téléphone</label>
              <input name="telephone" className={inputClass} />
            </div>
            <div className="col-span-2 space-y-1">
              <label className={labelClass}>Adresse</label>
              <input name="adresse" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Code postal</label>
              <input name="codePostal" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Ville</label>
              <input name="ville" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Précarité</label>
              <select name="precarite" className={inputClass} defaultValue="">
                <option value="">—</option>
                {Object.entries(precariteLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Zone climatique</label>
              <select name="zoneClimatique" className={inputClass} defaultValue="">
                <option value="">—</option>
                <option value="H1">H1</option>
                <option value="H2">H2</option>
                <option value="H3">H3</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <legend className="px-1 text-sm font-medium text-neutral-900">Dossier</legend>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={labelClass}>Type de dossier</label>
              <select name="type" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir...
                </option>
                {Object.entries(typeDossierLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Mode de paiement de l&apos;aide</label>
              <select name="modePaiementAide" className={inputClass} defaultValue="">
                <option value="">—</option>
                {Object.entries(modePaiementLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Devis TTC (€)</label>
              <input name="montantDevisTTC" type="number" step="0.01" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Date de signature</label>
              <input name="dateSignatureDevis" type="date" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Aide MPR / ANAH (€)</label>
              <input name="montantAideMPR" type="number" step="0.01" defaultValue={0} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Aide CEE (€)</label>
              <input name="montantAideCEE" type="number" step="0.01" defaultValue={0} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>MAR (accompagnateur rénov)</label>
              <input name="mar" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Délégataire CEE</label>
              <input name="delegataireCEE" className={inputClass} />
            </div>
          </div>
        </fieldset>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Créer le dossier
        </button>
      </form>
    </div>
  );
}
