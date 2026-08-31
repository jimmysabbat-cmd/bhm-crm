import { prisma } from "@/lib/prisma";
import { createStatutAnah, updateStatutAnah, toggleStatutAnah, reorder } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export default async function StatutsAnahPage() {
  const statuts = await prisma.statutAnah.findMany({ orderBy: { ordre: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Statuts du suivi administratif ANAH, affichés uniquement sur les dossiers de rénovation
        d&apos;ampleur (dépôt, instruction, avance, solde...).
      </p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {statuts.map((s, i) => (
              <tr key={s.id} className={`border-b border-neutral-100 last:border-0 ${!s.actif ? "opacity-50" : ""}`}>
                <td className="px-2 py-2">
                  <div className="flex gap-0.5">
                    <form action={async () => { "use server"; await reorder("statutAnah", s.id, "up"); }}>
                      <button type="submit" disabled={i === 0} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↑</button>
                    </form>
                    <form action={async () => { "use server"; await reorder("statutAnah", s.id, "down"); }}>
                      <button type="submit" disabled={i === statuts.length - 1} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↓</button>
                    </form>
                  </div>
                </td>
                <td className="w-full px-2 py-2">
                  <form action={updateStatutAnah.bind(null, s.id)} className="flex gap-2">
                    <input name="label" defaultValue={s.label} className={inputClass} />
                    <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800">
                      Enregistrer
                    </button>
                  </form>
                </td>
                <td className="px-2 py-2">
                  <form action={async () => { "use server"; await toggleStatutAnah(s.id, !s.actif); }}>
                    <button type="submit" className="whitespace-nowrap text-xs text-neutral-500 hover:text-neutral-900">
                      {s.actif ? "Archiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={createStatutAnah} className="flex gap-2">
        <input name="label" placeholder="Nouveau statut ANAH..." required className={inputClass} />
        <button type="submit" className="whitespace-nowrap rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          + Ajouter
        </button>
      </form>
    </div>
  );
}
