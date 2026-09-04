import { redirect } from "next/navigation";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { getPartnerDossiers, getPartnerPackages } from "@/lib/partners/access";
import { formatCents } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// ============================================================
// Espace partenaire (P11, section 23/24) - accès TRÈS limité pour un
// compte SOUS_TRAITANT ou DELEGATAIRE_CEE : ses dossiers/postes assignés
// (sous-traitant uniquement) et les packages qui lui sont explicitement
// destinés, avec uniquement les documents qu'ils contiennent. Jamais de
// marge, coût interne, avis d'imposition, détail ANAH/MPR, ni aucune autre
// donnée du CRM interne.
// ============================================================

export default async function PartenairePage() {
  const ctx = await requireUserContext();
  if (!isPartnerRole(ctx)) redirect("/");

  const [dossiers, packages] = await Promise.all([getPartnerDossiers(ctx), getPartnerPackages(ctx)]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Espace partenaire</h1>
        <p className="mt-1 text-sm text-slate-500">
          {ctx.role === "SOUS_TRAITANT" ? "Vos chantiers assignés et vos documents." : "Vos packages de transmission."}
        </p>
      </div>

      {ctx.role === "SOUS_TRAITANT" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">Chantiers assignés ({dossiers.length})</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Dossier</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Poste</th>
                <th className="px-4 py-3">Surface</th>
                <th className="px-4 py-3">Votre prix de pose</th>
              </tr>
            </thead>
            <tbody>
              {dossiers.flatMap((d) =>
                d.postes.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-5 py-3 font-medium text-slate-900">{d.reference}</td>
                    <td className="px-4 py-3 text-slate-500">{d.clientNom}</td>
                    <td className="px-4 py-3 text-slate-500">{p.type}</td>
                    <td className="px-4 py-3 text-slate-500">{p.surfaceM2 != null ? `${p.surfaceM2} m²` : "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{p.montantPoseSousTraitanceCts != null ? formatCents(p.montantPoseSousTraitanceCts) : "—"}</td>
                  </tr>
                ))
              )}
              {dossiers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                    Aucun chantier assigné pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">Documents transmis ({packages.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Dossier</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Pièces</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.packageId} className="border-t border-slate-100">
                <td className="px-5 py-3 font-medium text-slate-900">{p.dossierReference}</td>
                <td className="px-4 py-3">
                  <Badge color={p.status === "TRANSMIS" ? "emerald" : "blue"}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.documents.map((d) => d.typeDocumentNom ?? d.nomFichier).join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <a href={`/api/transmission-packages/${p.packageId}/zip`} className="text-xs font-medium text-emerald-700 hover:underline">
                    Télécharger (ZIP)
                  </a>
                </td>
              </tr>
            ))}
            {packages.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucun document transmis pour l&apos;instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
