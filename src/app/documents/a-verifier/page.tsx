import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ValidateRefuseButtons } from "../ValidateRefuseButtons";

export default async function DocumentsAVerifierPage() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "VIEW_DOCUMENTS")) redirect("/");

  const documents = await prisma.dossierDocument.findMany({
    where: { organisationId: ctx.organisationId, statut: { in: ["FOURNI", "A_VERIFIER"] } },
    include: {
      dossier: { select: { id: true, reference: true, client: { select: { prenom: true, nom: true } } } },
      typeDocumentRef: { select: { nom: true } },
      requirement: { select: { responsable: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const peutValider = hasPermission(ctx, "VALIDATE_DOCUMENTS");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Documents à vérifier</h1>
          <p className="mt-1 text-sm text-slate-500">{documents.length} pièce(s) en attente de validation.</p>
        </div>
        <Link href="/documents/manquants" className="text-sm font-medium text-slate-500 hover:text-emerald-700">
          Documents manquants →
        </Link>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Dossier</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Uploadé le</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link href={`/dossiers/${d.dossier.id}`} className="font-medium text-slate-900 hover:text-emerald-700">
                    {d.dossier.reference}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {d.dossier.client.prenom} {d.dossier.client.nom}
                </td>
                <td className="px-4 py-3 text-slate-500">{d.typeDocumentRef?.nom ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{d.createdAt.toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500">{d.requirement?.responsable ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge color="amber">{d.statut}</Badge>
                </td>
                <td className="px-4 py-3">
                  {peutValider && <ValidateRefuseButtons docId={d.id} />}
                  <Link href={`/dossiers/${d.dossier.id}`} className="ml-2 text-xs font-medium text-slate-400 hover:text-emerald-700">
                    Ouvrir
                  </Link>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucune pièce en attente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
