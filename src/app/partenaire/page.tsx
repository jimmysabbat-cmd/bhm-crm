import { redirect } from "next/navigation";
import { requireUserContext, isPartnerRole } from "@/lib/authz";
import { getPartnerDossiers, getPartnerPackages, getPartnerMissions } from "@/lib/partners/access";
import { getMissionsFacturablesSousTraitant, getFacturesForSousTraitant } from "@/lib/facturation/access";
import { formatCents } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MissionActions } from "./MissionActions";
import { DeposerFactureForm } from "./DeposerFactureForm";

const FACTURE_STATUT_LABELS: Record<string, string> = {
  BROUILLON: "Brouillon",
  EMISE: "Envoyée",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  EN_RETARD: "En retard",
  ANNULEE: "Annulée",
  LITIGE: "Litige",
};
const FACTURE_STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  BROUILLON: "slate",
  EMISE: "blue",
  PARTIELLEMENT_PAYEE: "amber",
  PAYEE: "emerald",
  EN_RETARD: "red",
  ANNULEE: "slate",
  LITIGE: "red",
};

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

  const [dossiers, packages, missions, missionsFacturables, factures] = await Promise.all([
    getPartnerDossiers(ctx),
    getPartnerPackages(ctx),
    getPartnerMissions(ctx),
    ctx.role === "SOUS_TRAITANT" ? getMissionsFacturablesSousTraitant(ctx) : Promise.resolve([]),
    ctx.role === "SOUS_TRAITANT" ? getFacturesForSousTraitant(ctx) : Promise.resolve([]),
  ]);

  const STATUT_LABELS: Record<string, string> = {
    ENVOYEE: "Envoyée",
    ACCEPTEE: "Acceptée",
    REFUSEE: "Refusée",
    PLANIFIEE: "Planifiée",
    EN_COURS: "En cours",
    TERMINEE: "Terminée",
  };
  const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber"> = {
    ENVOYEE: "blue",
    ACCEPTEE: "emerald",
    REFUSEE: "red",
    PLANIFIEE: "blue",
    EN_COURS: "amber",
    TERMINEE: "emerald",
  };

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
          <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">Mes missions ({missions.length})</div>
          <div className="divide-y divide-slate-100">
            {missions.map((m) => (
              <div key={m.packageId} className="px-5 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-900">
                    {m.dossierReference} — {m.posteType ?? "Poste"}
                  </div>
                  <Badge color={STATUT_COLORS[m.status] ?? "blue"}>{STATUT_LABELS[m.status] ?? m.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600">
                  {(m.client.prenom || m.client.nom) && (
                    <div>
                      Client : {m.client.prenom} {m.client.nom}
                    </div>
                  )}
                  {m.client.telephone && <div>Téléphone : {m.client.telephone}</div>}
                  {m.client.adresse && <div>Adresse : {m.client.adresse}</div>}
                  {m.travaux.surfaceM2 != null && <div>Surface : {m.travaux.surfaceM2} m²</div>}
                  {m.travaux.quantite != null && <div>Quantité : {m.travaux.quantite}</div>}
                  {(m.dateDebutSouhaitee || m.dateFinSouhaitee) && (
                    <div>
                      Dates souhaitées : {m.dateDebutSouhaitee ? new Date(m.dateDebutSouhaitee).toLocaleDateString("fr-FR") : "—"} →{" "}
                      {m.dateFinSouhaitee ? new Date(m.dateFinSouhaitee).toLocaleDateString("fr-FR") : "—"}
                    </div>
                  )}
                  {m.prixConvenuCts != null && <div>Prix convenu : {formatCents(m.prixConvenuCts)}</div>}
                </div>
                {m.instructions && <div className="text-sm text-slate-600">Instructions : {m.instructions}</div>}
                {m.documents.length > 0 && (
                  <div className="text-sm text-slate-500">Documents partagés : {m.documents.map((d) => d.typeDocumentNom ?? d.nomFichier).join(", ")}</div>
                )}
                <MissionActions packageId={m.packageId} status={m.status} />
              </div>
            ))}
            {missions.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Aucune mission pour l&apos;instant.</div>}
          </div>
        </Card>
      )}

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

      {ctx.role === "SOUS_TRAITANT" && (missionsFacturables.length > 0 || factures.length > 0) && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">Mes factures</div>
          <div className="divide-y divide-slate-100">
            {missionsFacturables.map((m) => (
              <div key={m.packageId} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{m.dossierReference}</span>
                    <span className="text-slate-400"> — {m.posteType ?? "Poste"}</span>
                    {m.prixConvenuCts != null && <span className="text-slate-500"> · prix convenu {formatCents(m.prixConvenuCts)}</span>}
                  </div>
                  {m.factureExistante ? (
                    <Badge color={FACTURE_STATUT_COLORS[m.factureExistante.statutAffiche] ?? "slate"}>
                      Facture {m.factureExistante.numero} — {FACTURE_STATUT_LABELS[m.factureExistante.statutAffiche] ?? m.factureExistante.statutAffiche}
                    </Badge>
                  ) : (
                    <DeposerFactureForm packageId={m.packageId} prixSuggereEuros={m.prixConvenuCts != null ? m.prixConvenuCts / 100 : null} />
                  )}
                </div>
              </div>
            ))}
            {factures.length > 0 && (
              <div className="px-5 py-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Historique</p>
                <table className="w-full text-sm">
                  <tbody>
                    {factures.map((f) => (
                      <tr key={f.id} className="border-t border-slate-100 first:border-t-0">
                        <td className="py-2 font-medium text-slate-900">{f.numero}</td>
                        <td className="py-2 text-slate-500">{f.dossierReference}</td>
                        <td className="py-2 text-slate-500">{formatCents(f.montantTTCCts)}</td>
                        <td className="py-2 text-slate-500">{f.dateEmission.toLocaleDateString("fr-FR")}</td>
                        <td className="py-2">
                          <Badge color={FACTURE_STATUT_COLORS[f.statutAffiche] ?? "slate"}>{FACTURE_STATUT_LABELS[f.statutAffiche] ?? f.statutAffiche}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
