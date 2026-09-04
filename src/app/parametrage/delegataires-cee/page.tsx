import { Plus, Clock, Coins } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createDelegataireCee, updateDelegataireCee, toggleDelegataireCee, deleteItem } from "../actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";

function centsToRate(cts: number | null): string {
  return cts === null ? "" : (cts / 100).toString();
}

export default async function DelegatairesCeePage() {
  const ctx = await requireUserContext();
  const delegataires = await prisma.delegataireCee.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Délégataires CEE proposés sur les dossiers percevant une prime CEE, avec leurs taux de
        rachat (€/MCumac) et leur délai de paiement après dépôt du dossier chez eux.
      </p>

      <Card className="overflow-hidden">
        {delegataires.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun délégataire CEE.</p>
        )}
        {delegataires.map((d) => (
          <details
            key={d.id}
            className={`group border-b border-slate-100 px-5 py-4 last:border-0 ${
              !d.actif ? "opacity-40" : ""
            }`}
          >
            <summary className="flex cursor-pointer list-none items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{d.nom}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  {(d.rachatTresModesteCts !== null || d.rachatClassiqueCts !== null) && (
                    <span className="flex items-center gap-1">
                      <Coins className="h-3 w-3" />
                      {d.rachatTresModesteCts !== null &&
                        `TM ${(d.rachatTresModesteCts / 100).toFixed(2)}€/MCumac`}
                      {d.rachatTresModesteCts !== null && d.rachatClassiqueCts !== null && " · "}
                      {d.rachatClassiqueCts !== null &&
                        `Classique ${(d.rachatClassiqueCts / 100).toFixed(2)}€/MCumac`}
                    </span>
                  )}
                  {d.delaiPaiementJours && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> délai {d.delaiPaiementJours} j
                    </span>
                  )}
                </div>
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-slate-400 group-hover:text-emerald-600">
                Modifier
              </span>
              <form action={async () => { "use server"; await toggleDelegataireCee(d.id, !d.actif); }}>
                <button
                  type="submit"
                  className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-emerald-600"
                >
                  {d.actif ? "Archiver" : "Réactiver"}
                </button>
              </form>
              <form action={async () => { "use server"; await deleteItem("delegataireCee", d.id); }}>
                <ConfirmSubmitButton
                  label="Supprimer"
                  confirmMessage="Supprimer définitivement ce délégataire ? S'il est encore utilisé par un dossier, il sera archivé à la place."
                  className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-red-600"
                />
              </form>
            </summary>

            <form
              action={updateDelegataireCee.bind(null, d.id)}
              className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"
            >
              <div className="space-y-1">
                <label className={labelClass}>Nom</label>
                <input name="nom" defaultValue={d.nom} required className={smallInputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Rachat très modeste (€/MCumac)</label>
                <input
                  name="rachatTresModeste"
                  type="number"
                  step="0.01"
                  defaultValue={centsToRate(d.rachatTresModesteCts)}
                  className={smallInputClass}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Rachat modeste/classique (€/MCumac)</label>
                <input
                  name="rachatClassique"
                  type="number"
                  step="0.01"
                  defaultValue={centsToRate(d.rachatClassiqueCts)}
                  className={smallInputClass}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Délai de paiement (j)</label>
                <input
                  name="delaiPaiementJours"
                  type="number"
                  defaultValue={d.delaiPaiementJours ?? ""}
                  className={smallInputClass}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" className="text-xs">
                  Enregistrer
                </Button>
              </div>
            </form>
          </details>
        ))}
      </Card>

      <form action={createDelegataireCee} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-900">Ajouter un délégataire CEE</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Rachat très modeste (€/MCumac)</label>
            <input name="rachatTresModeste" type="number" step="0.01" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Rachat modeste/classique (€/MCumac)</label>
            <input name="rachatClassique" type="number" step="0.01" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Délai de paiement (jours après dépôt)</label>
            <input name="delaiPaiementJours" type="number" className={inputClass} />
          </div>
        </div>
        <Button type="submit">
          <Plus className="h-4 w-4" />
          Créer
        </Button>
      </form>
    </div>
  );
}
