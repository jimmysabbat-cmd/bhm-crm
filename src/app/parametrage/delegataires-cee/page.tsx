import { prisma } from "@/lib/prisma";
import { createDelegataireCee, updateDelegataireCee, toggleDelegataireCee, reorder } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export default async function DelegatairesCeePage() {
  const delegataires = await prisma.delegataireCee.findMany({ orderBy: { ordre: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Délégataires CEE proposés sur les dossiers percevant une prime CEE.
      </p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {delegataires.map((d, i) => (
              <tr key={d.id} className={`border-b border-neutral-100 last:border-0 ${!d.actif ? "opacity-50" : ""}`}>
                <td className="px-2 py-2">
                  <div className="flex gap-0.5">
                    <form action={async () => { "use server"; await reorder("delegataireCee", d.id, "up"); }}>
                      <button type="submit" disabled={i === 0} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↑</button>
                    </form>
                    <form action={async () => { "use server"; await reorder("delegataireCee", d.id, "down"); }}>
                      <button type="submit" disabled={i === delegataires.length - 1} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↓</button>
                    </form>
                  </div>
                </td>
                <td className="w-full px-2 py-2">
                  <form action={updateDelegataireCee.bind(null, d.id)} className="flex gap-2">
                    <input name="nom" defaultValue={d.nom} className={inputClass} />
                    <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800">
                      Enregistrer
                    </button>
                  </form>
                </td>
                <td className="px-2 py-2">
                  <form action={async () => { "use server"; await toggleDelegataireCee(d.id, !d.actif); }}>
                    <button type="submit" className="whitespace-nowrap text-xs text-neutral-500 hover:text-neutral-900">
                      {d.actif ? "Archiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={createDelegataireCee} className="flex gap-2">
        <input name="nom" placeholder="Nouveau délégataire CEE..." required className={inputClass} />
        <button type="submit" className="whitespace-nowrap rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          + Ajouter
        </button>
      </form>
    </div>
  );
}
