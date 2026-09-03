import Link from "next/link";
import { Plus, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { resteAChargeCents } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import { Badge, statutColor } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;
  const ctx = await requireUserContext();

  const [dossiers, statutFiltre] = await Promise.all([
    prisma.dossier.findMany({
      where: { organisationId: ctx.organisationId, ...(statut ? { statutId: statut } : {}) },
      include: { client: true, type: true, statut: true },
      orderBy: { createdAt: "desc" },
    }),
    statut ? prisma.dossierStatus.findUnique({ where: { id: statut } }) : null,
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dossiers</h1>
          <p className="mt-1 text-sm text-slate-500">
            {dossiers.length} dossier{dossiers.length > 1 ? "s" : ""}
            {statutFiltre ? ` · ${statutFiltre.label}` : ""}
          </p>
        </div>
        <Link href="/dossiers/new">
          <Button>
            <Plus className="h-4 w-4" />
            Nouveau dossier
          </Button>
        </Link>
      </div>

      {statutFiltre && (
        <Link
          href="/dossiers"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retirer le filtre « {statutFiltre.label} »
        </Link>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3">Devis TTC</th>
              <th className="px-5 py-3">Reste à charge</th>
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-3.5">
                  <Link
                    href={`/dossiers/${d.id}`}
                    className="font-medium text-slate-900 hover:text-emerald-700"
                  >
                    {d.client.prenom} {d.client.nom}
                  </Link>
                  <p className="text-xs text-slate-400">{d.reference}</p>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{d.type.label}</td>
                <td className="px-5 py-3.5">
                  <Badge color={statutColor(d.statut.key)}>{d.statut.label}</Badge>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{formatCents(d.montantDevisTTC)}</td>
                <td className="px-5 py-3.5 font-medium text-slate-900">
                  {formatCents(resteAChargeCents(d))}
                </td>
              </tr>
            ))}
            {dossiers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  Aucun dossier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
