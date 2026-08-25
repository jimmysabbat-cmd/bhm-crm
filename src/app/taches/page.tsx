import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { typeTacheLabels } from "@/lib/dossier-labels";
import { toggleTache } from "../dossiers/actions";

export default async function TachesPage() {
  const taches = await prisma.tache.findMany({
    where: { statut: "A_FAIRE" },
    include: { dossier: { include: { client: true } } },
    orderBy: { dateEcheance: "asc" },
  });

  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Tâches & relances</h1>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium"></th>
              <th className="px-4 py-3 font-medium">Client / dossier</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Titre</th>
              <th className="px-4 py-3 font-medium">Échéance</th>
            </tr>
          </thead>
          <tbody>
            {taches.map((t) => {
              const late = new Date(t.dateEcheance).getTime() < now;
              return (
                <tr key={t.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <form
                      action={async () => {
                        "use server";
                        await toggleTache(t.id, true);
                      }}
                    >
                      <button
                        type="submit"
                        className="h-4 w-4 rounded border border-neutral-300"
                        aria-label="Marquer comme fait"
                      />
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dossiers/${t.dossierId}`} className="font-medium text-neutral-900 hover:underline">
                      {t.dossier.client.prenom} {t.dossier.client.nom}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{typeTacheLabels[t.type]}</td>
                  <td className="px-4 py-3 text-neutral-600">{t.titre}</td>
                  <td className={`px-4 py-3 ${late ? "text-red-600" : "text-neutral-600"}`}>
                    {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
                  </td>
                </tr>
              );
            })}
            {taches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Aucune tâche en attente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
