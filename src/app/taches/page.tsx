import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { typeTacheLabels } from "@/lib/dossier-labels";
import { toggleTache, deleteTache } from "../dossiers/actions";
import { Card } from "@/components/ui/Card";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";

export default async function TachesPage() {
  const ctx = await requireUserContext();
  const taches = await prisma.tache.findMany({
    where: { statut: "A_FAIRE", dossier: { organisationId: ctx.organisationId } },
    include: { dossier: { include: { client: true } } },
    orderBy: { dateEcheance: "asc" },
  });

  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tâches & relances</h1>
        <p className="mt-1 text-sm text-slate-500">
          {taches.length} tâche{taches.length > 1 ? "s" : ""} en attente
        </p>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3">Client / dossier</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Titre</th>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {taches.map((t) => {
              const late = new Date(t.dateEcheance).getTime() < now;
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <form
                      action={async () => {
                        "use server";
                        await toggleTache(t.id, true);
                      }}
                    >
                      <button
                        type="submit"
                        className="h-4 w-4 rounded border border-slate-300 transition hover:border-emerald-500 hover:bg-emerald-50"
                        aria-label="Marquer comme fait"
                      />
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dossiers/${t.dossierId}`}
                      className="font-medium text-slate-900 hover:text-emerald-700"
                    >
                      {t.dossier.client.prenom} {t.dossier.client.nom}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{typeTacheLabels[t.type]}</td>
                  <td className="px-4 py-3 text-slate-500">{t.titre}</td>
                  <td className="px-4 py-3">
                    {late ? (
                      <span className="flex items-center gap-1.5 text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={async () => { "use server"; await deleteTache(t.id, t.dossierId); }}>
                      <ConfirmSubmitButton
                        label="Supprimer"
                        confirmMessage="Supprimer cette tâche ?"
                        className="text-xs font-medium text-slate-400 hover:text-red-600"
                      />
                    </form>
                  </td>
                </tr>
              );
            })}
            {taches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  Aucune tâche en attente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
