import { prisma } from "@/lib/prisma";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { createSousTraitant, toggleSousTraitant } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const labelClass = "text-sm font-medium text-neutral-700";

export default async function SousTraitantsPage() {
  const sousTraitants = await prisma.sousTraitant.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Sous-traitants proposés pour la pose d&apos;un poste de travaux sur un dossier.
      </p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Spécialité</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Délai paiement</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sousTraitants.map((s) => (
              <tr key={s.id} className={`border-t border-neutral-100 ${!s.actif ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-medium text-neutral-900">{s.nom}</td>
                <td className="px-4 py-3 text-neutral-600">
                  {s.typeTravaux ? typeTravauxLabels[s.typeTravaux] : "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {[s.telephone, s.email].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {s.delaiPaiementJours ? `${s.delaiPaiementJours} j` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <form action={async () => { "use server"; await toggleSousTraitant(s.id, !s.actif); }}>
                    <button type="submit" className="text-xs text-neutral-500 hover:text-neutral-900">
                      {s.actif ? "Archiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {sousTraitants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Aucun sous-traitant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={createSousTraitant} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Ajouter un sous-traitant</h2>
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
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Créer
        </button>
      </form>
    </div>
  );
}
