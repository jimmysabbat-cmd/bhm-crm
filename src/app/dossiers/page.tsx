import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { resteAChargeCents } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import { Badge, statutColor } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; source?: string }>;
}) {
  const { statut, source } = await searchParams;
  // ?source=do : boîte de réception des chantiers envoyés par les donneurs
  // d'ordre (les demandes à traiter en premier).
  const sourceDo = source === "do";
  const ctx = await requireUserContext();
  // P11 (section 23/24) - un compte partenaire ne voit jamais la liste
  // complète des dossiers de l'organisation.
  if (isPartnerRole(ctx)) redirect("/partenaire");

  const [dossiers, statutFiltre, nbDemandesDoATraiter] = await Promise.all([
    prisma.dossier.findMany({
      where: { organisationId: ctx.organisationId, ...(statut ? { statutId: statut } : {}), ...(sourceDo ? { donneurOrdreId: { not: null } } : {}) },
      include: { client: true, type: true, statut: true, donneurOrdre: { select: { nom: true } } },
      orderBy: { createdAt: "desc" },
    }),
    statut ? prisma.dossierStatus.findUnique({ where: { id: statut } }) : null,
    prisma.dossier.count({ where: { organisationId: ctx.organisationId, donneurOrdreId: { not: null }, statut: { key: "PROSPECT_ETUDE" } } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dossiers</h1>
          <p className="mt-1 text-sm text-slate-500">
            {dossiers.length} dossier{dossiers.length > 1 ? "s" : ""}
            {statutFiltre ? ` · ${statutFiltre.label}` : ""}
            {sourceDo ? " · envoyés par des donneurs d'ordre" : ""}
          </p>
        </div>
        <Link href="/dossiers/new">
          <Button>
            <Plus className="h-4 w-4" />
            Nouveau dossier
          </Button>
        </Link>
      </div>

      <div className="flex gap-2 text-sm">
        <Link href="/dossiers" className={`rounded-full border px-3 py-1 ${!sourceDo ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Tous
        </Link>
        <Link href="/dossiers?source=do" className={`rounded-full border px-3 py-1 ${sourceDo ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Donneurs d&apos;ordre
          {nbDemandesDoATraiter > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{nbDemandesDoATraiter} à traiter</span>}
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
              <th className="px-5 py-3">Type / origine</th>
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
                <td className="px-5 py-3.5 text-slate-600">
                  {d.type.label}
                  {d.donneurOrdre && <p className="text-xs text-amber-700">DO : {d.donneurOrdre.nom}</p>}
                </td>
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
