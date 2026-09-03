import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createProgrammeVersion, dupliquerProgrammeVersion, publierProgrammeVersion } from "../../programmes-actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";

export default async function ProgrammeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUserContext();

  const programme = await prisma.programme.findFirst({
    where: { id, organisationId: ctx.organisationId },
    include: {
      versions: {
        include: { _count: { select: { etapes: true, dossiers: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!programme) notFound();

  return (
    <div className="space-y-6">
      <Link href="/parametrage/programmes" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700">
        <ArrowLeft className="h-3.5 w-3.5" />
        Programmes
      </Link>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{programme.nom}</h2>
        {programme.description && <p className="mt-1 text-sm text-slate-500">{programme.description}</p>}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Version</th>
              <th className="px-5 py-3">Étapes</th>
              <th className="px-5 py-3">Dossiers</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {programme.versions.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-5 py-3.5">
                  <Link
                    href={`/parametrage/programmes/${programme.id}/versions/${v.id}`}
                    className="font-medium text-slate-900 hover:text-emerald-700"
                  >
                    v{v.numeroVersion}
                  </Link>
                  {v.nomVersion && <p className="text-xs text-slate-400">{v.nomVersion}</p>}
                </td>
                <td className="px-5 py-3.5 text-slate-600">{v._count.etapes}</td>
                <td className="px-5 py-3.5 text-slate-600">{v._count.dossiers}</td>
                <td className="px-5 py-3.5">
                  <Badge color={v.publie ? "emerald" : "slate"}>{v.publie ? "Publiée" : "Brouillon"}</Badge>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {!v.publie && (
                      <form action={async () => { "use server"; await publierProgrammeVersion(v.id); }}>
                        <button type="submit" className="text-xs font-medium text-emerald-700 hover:text-emerald-800">
                          Publier
                        </button>
                      </form>
                    )}
                    <details className="relative">
                      <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-700">
                        <Copy className="inline h-3.5 w-3.5" /> Dupliquer
                      </summary>
                      <form
                        action={dupliquerProgrammeVersion.bind(null, v.id)}
                        className="absolute right-0 z-10 mt-2 flex w-48 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
                      >
                        <input
                          name="numeroVersion"
                          placeholder="Ex. 2026.2"
                          required
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                          OK
                        </button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
            {programme.versions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  Aucune version.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <form action={createProgrammeVersion} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <input type="hidden" name="programmeId" value={programme.id} />
        <div className="space-y-1">
          <label className={labelClass}>Numéro de version</label>
          <input name="numeroVersion" required placeholder="Ex. 2026.1" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Nom (optionnel)</label>
          <input name="nomVersion" className={inputClass} />
        </div>
        <Button type="submit">Créer une nouvelle version vide</Button>
      </form>
    </div>
  );
}
