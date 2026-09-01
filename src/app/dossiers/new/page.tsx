import { User, FileText } from "lucide-react";
import { createDossier } from "../actions";
import { precariteLabels } from "@/lib/dossier-labels";
import { prisma } from "@/lib/prisma";
import { TypeFields } from "./type-fields";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

export default async function NewDossierPage() {
  const [types, modesPaiement, mars, delegatairesCee] = await Promise.all([
    prisma.dossierType.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.modePaiement.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.mar.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.delegataireCee.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nouveau dossier</h1>
        <p className="mt-1 text-sm text-slate-500">Renseigne le client et le montage du dossier</p>
      </div>

      <form action={createDossier} className="space-y-6">
        <fieldset className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-900">
            <User className="h-4 w-4 text-emerald-600" />
            Client
          </legend>
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

        <fieldset className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-emerald-600" />
            Dossier
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <TypeFields types={types} mars={mars} />
            <div className="space-y-1">
              <label className={labelClass}>Mode de paiement de l&apos;aide</label>
              <select name="modePaiementAideId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {modesPaiement.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
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
              <input
                id="montantAideMPR"
                name="montantAideMPR"
                type="number"
                step="0.01"
                defaultValue={0}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Aide CEE (€)</label>
              <input name="montantAideCEE" type="number" step="0.01" defaultValue={0} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Délégataire CEE</label>
              <select name="delegataireCeeId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {delegatairesCee.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <Button type="submit">Créer le dossier</Button>
      </form>
    </div>
  );
}
