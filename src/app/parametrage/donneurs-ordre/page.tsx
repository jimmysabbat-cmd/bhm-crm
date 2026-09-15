import { Plus, Phone, Mail } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createDonneurOrdre, updateDonneurOrdre, toggleDonneurOrdre, deleteDonneurOrdre } from "../actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";

export default async function DonneursOrdrePage() {
  const ctx = await requireUserContext();
  const donneursOrdre = await prisma.donneurOrdre.findMany({
    where: { organisationId: ctx.organisationId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Entreprises externes qui vous envoient des chantiers à exécuter (apport d&apos;affaire). Un
        compte de connexion au portail donneur d&apos;ordre se crée ensuite depuis l&apos;onglet
        Équipe, rattaché à l&apos;une des fiches ci-dessous.
      </p>

      <Card className="overflow-hidden">
        {donneursOrdre.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun donneur d&apos;ordre.</p>
        )}
        {donneursOrdre.map((d) => (
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
                  {d.contactTelephone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {d.contactTelephone}
                    </span>
                  )}
                  {d.contactEmail && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {d.contactEmail}
                    </span>
                  )}
                </div>
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-slate-400 group-hover:text-emerald-600">
                Modifier
              </span>
              <form action={async () => { "use server"; await toggleDonneurOrdre(d.id, !d.actif); }}>
                <button
                  type="submit"
                  className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-emerald-600"
                >
                  {d.actif ? "Archiver" : "Réactiver"}
                </button>
              </form>
              <form action={async () => { "use server"; await deleteDonneurOrdre(d.id); }}>
                <ConfirmSubmitButton
                  label="Supprimer"
                  confirmMessage="Supprimer définitivement ce donneur d'ordre ? S'il est encore lié à des dossiers ou factures, il sera archivé à la place."
                  className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-red-600"
                />
              </form>
            </summary>

            <form
              action={updateDonneurOrdre.bind(null, d.id)}
              className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3"
            >
              <div className="space-y-1">
                <label className={labelClass}>Nom</label>
                <input name="nom" defaultValue={d.nom} required className={smallInputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Téléphone</label>
                <input name="contactTelephone" defaultValue={d.contactTelephone ?? ""} className={smallInputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Email</label>
                <input name="contactEmail" type="email" defaultValue={d.contactEmail ?? ""} className={smallInputClass} />
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

      <form action={createDonneurOrdre} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-900">Ajouter un donneur d&apos;ordre</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="contactTelephone" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="contactEmail" type="email" className={inputClass} />
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
