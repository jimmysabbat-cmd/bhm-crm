import { prisma } from "@/lib/prisma";
import { createDossierType, updateDossierType, toggleDossierType, reorder } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export default async function TypesDossierPage() {
  const types = await prisma.dossierType.findMany({ orderBy: { ordre: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Types de dossier proposés à la création (rénovation d&apos;ampleur ANAH, CEE seul, monogeste...).
      </p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {types.map((t, i) => (
              <tr key={t.id} className={`border-b border-neutral-100 last:border-0 ${!t.actif ? "opacity-50" : ""}`}>
                <td className="px-2 py-2">
                  <div className="flex gap-0.5">
                    <form action={async () => { "use server"; await reorder("dossierType", t.id, "up"); }}>
                      <button type="submit" disabled={i === 0} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↑</button>
                    </form>
                    <form action={async () => { "use server"; await reorder("dossierType", t.id, "down"); }}>
                      <button type="submit" disabled={i === types.length - 1} className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30">↓</button>
                    </form>
                  </div>
                </td>
                <td className="w-full px-2 py-2">
                  <form action={updateDossierType.bind(null, t.id)} className="flex gap-2">
                    <input name="label" defaultValue={t.label} className={inputClass} />
                    <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800">
                      Enregistrer
                    </button>
                  </form>
                </td>
                <td className="px-2 py-2">
                  <form action={async () => { "use server"; await toggleDossierType(t.id, !t.actif); }}>
                    <button type="submit" className="whitespace-nowrap text-xs text-neutral-500 hover:text-neutral-900">
                      {t.actif ? "Archiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={createDossierType} className="flex gap-2">
        <input name="label" placeholder="Nouveau type de dossier..." required className={inputClass} />
        <button type="submit" className="whitespace-nowrap rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          + Ajouter
        </button>
      </form>
    </div>
  );
}
