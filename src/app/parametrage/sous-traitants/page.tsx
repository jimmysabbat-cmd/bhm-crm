import { Plus, Phone, Mail, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { createSousTraitant, toggleSousTraitant } from "../actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";

export default async function SousTraitantsPage() {
  const sousTraitants = await prisma.sousTraitant.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Sous-traitants proposés pour la pose d&apos;un poste de travaux sur un dossier.
      </p>

      <Card className="overflow-hidden">
        {sousTraitants.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun sous-traitant.</p>
        )}
        {sousTraitants.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-0 ${
              !s.actif ? "opacity-40" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{s.nom}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {s.typeTravaux && <Badge color="violet">{typeTravauxLabels[s.typeTravaux]}</Badge>}
                {s.telephone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {s.telephone}
                  </span>
                )}
                {s.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {s.email}
                  </span>
                )}
                {s.delaiPaiementJours && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {s.delaiPaiementJours} j
                  </span>
                )}
              </div>
            </div>
            <form action={async () => { "use server"; await toggleSousTraitant(s.id, !s.actif); }}>
              <button type="submit" className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-red-600">
                {s.actif ? "Archiver" : "Réactiver"}
              </button>
            </form>
          </div>
        ))}
      </Card>

      <form action={createSousTraitant} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-900">Ajouter un sous-traitant</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Spécialité</label>
            <select name="typeTravaux" className={inputClass} defaultValue="">
              <option value="">—</option>
              {Object.entries(typeTravauxLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="telephone" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Délai de paiement (jours après fin travaux)</label>
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
