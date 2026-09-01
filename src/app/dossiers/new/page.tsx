import { User, FileText } from "lucide-react";
import { createDossier } from "../actions";
import { precariteLabels } from "@/lib/dossier-labels";
import { prisma } from "@/lib/prisma";
import { DossierFields } from "./dossier-fields";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

export default async function NewDossierPage() {
  const [types, modesPaiement, mars, statutsAnah, delegatairesCee, statuts] = await Promise.all([
    prisma.dossierType.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.modePaiement.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.mar.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.statutAnah.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.delegataireCee.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.dossierStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
  ]);
  const statutParDefaut = statuts.find((s) => s.key === "DEVIS_SIGNE")?.id ?? statuts[0]?.id ?? "";

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
            <div className="space-y-1">
              <label className={labelClass}>Surface habitable (m²)</label>
              <input name="surfaceHabitableM2" type="number" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Année de construction</label>
              <input name="anneeConstruction" type="number" className={inputClass} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-emerald-600" />
            Dossier
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <DossierFields types={types} mars={mars} statutsAnah={statutsAnah} delegatairesCee={delegatairesCee} />
            <div className="space-y-1">
              <label className={labelClass}>Statut initial</label>
              <select name="statutId" defaultValue={statutParDefaut} className={inputClass}>
                {statuts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Circuit de versement de l&apos;aide</label>
              <select name="modePaiementAideId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {modesPaiement.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                Qui avance l&apos;argent (client, ANAH, BHM en mandataire...) — pas le programme
                d&apos;aide lui-même, déjà défini par le type de dossier.
              </p>
            </div>
            <input id="montantAideMPR" name="montantAideMPR" type="hidden" defaultValue={0} />
          </div>
        </fieldset>

        <Button type="submit">Créer le dossier</Button>
      </form>
    </div>
  );
}
