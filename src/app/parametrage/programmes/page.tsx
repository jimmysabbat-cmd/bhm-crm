import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createProgramme, toggleProgrammeActif } from "../programmes-actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";

export default async function ProgrammesPage() {
  const ctx = await requireUserContext();
  const programmes = await prisma.programme.findMany({
    where: { organisationId: ctx.organisationId },
    include: { versions: { select: { id: true, publie: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Un programme définit un parcours métier paramétrable (étapes, délais, responsables,
        dépendances, tâches automatiques) - sans rien coder en dur. Chaque programme a plusieurs
        versions ; une version publiée est figée pour ne jamais changer le comportement des
        dossiers déjà engagés.
      </p>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Programme</th>
              <th className="px-5 py-3">Versions</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {programmes.map((p) => {
              const versionsPubliees = p.versions.filter((v) => v.publie).length;
              return (
                <tr key={p.id} className={`border-t border-slate-100 ${!p.actif ? "opacity-40" : ""}`}>
                  <td className="px-5 py-3.5">
                    <Link href={`/parametrage/programmes/${p.id}`} className="font-medium text-slate-900 hover:text-emerald-700">
                      {p.nom}
                    </Link>
                    <p className="text-xs text-slate-400">{p.code}</p>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {p.versions.length} version{p.versions.length > 1 ? "s" : ""}
                    {versionsPubliees > 0 && (
                      <Badge color="emerald">{versionsPubliees} publiée{versionsPubliees > 1 ? "s" : ""}</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <form action={async () => { "use server"; await toggleProgrammeActif(p.id, !p.actif); }}>
                      <button type="submit" className="text-xs font-medium text-slate-400 hover:text-red-600">
                        {p.actif ? "Archiver" : "Réactiver"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {programmes.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-slate-400">
                  Aucun programme.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <form action={createProgramme} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-900">Créer un programme</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" required placeholder="Ex. Rénovation d'ampleur ANAH" className={inputClass} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className={labelClass}>Description</label>
            <input name="description" className={inputClass} />
          </div>
        </div>
        <Button type="submit">
          <Plus className="h-4 w-4" />
          Créer le programme
        </Button>
      </form>
    </div>
  );
}
