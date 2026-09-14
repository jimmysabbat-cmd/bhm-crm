import { redirect, notFound } from "next/navigation";
import { requireUserContext } from "@/lib/authz";
import { getDemandeDetailForDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComplementForm } from "../ComplementForm";

// P16 - vue détail STRICTEMENT restreinte au périmètre du donneur d'ordre :
// client/prestation/statut/documents qu'il a fournis. Jamais de marge,
// coût interne, sous-traitant assigné ou tout autre détail interne (même
// discipline que l'espace partenaire sous-traitant/délégataire CEE).
export default async function DemandeDetailPage({ params }: { params: Promise<{ dossierId: string }> }) {
  const { dossierId } = await params;
  const ctx = await requireUserContext();
  if (ctx.role !== "DONNEUR_ORDRE") redirect("/");

  let dossier;
  try {
    dossier = await getDemandeDetailForDonneurOrdre(ctx, dossierId);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{dossier.reference}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {dossier.client.prenom} {dossier.client.nom}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{dossier.statut.label}</p>
      </div>

      {dossier.complementDemandeMessage && !dossier.complementReponseMessage && (
        <ComplementForm dossierId={dossier.id} message={dossier.complementDemandeMessage} />
      )}
      {dossier.complementReponseMessage && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Votre réponse : {dossier.complementReponseMessage}</div>
      )}

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Client</CardTitle>
        </CardHeader>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600">
          {dossier.client.telephone && <div>Téléphone : {dossier.client.telephone}</div>}
          {dossier.client.email && <div>Email : {dossier.client.email}</div>}
          {dossier.client.adresse && <div className="col-span-2">Adresse : {dossier.client.adresse}</div>}
          {dossier.client.ville && <div>Ville : {dossier.client.ville}</div>}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Prestation</CardTitle>
        </CardHeader>
        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {dossier.postesTravaux.map((p) => (
            <div key={p.id}>
              {typeTravauxLabels[p.type] ?? p.type}
              {p.surfaceM2 ? ` — ${p.surfaceM2} m²` : ""}
              {p.quantite ? ` — quantité ${p.quantite}` : ""}
            </div>
          ))}
          {(dossier.dateDebutTravaux || dossier.dateFinTravaux) && (
            <div className="pt-2 text-slate-500">
              Dates : {dossier.dateDebutTravaux ? dossier.dateDebutTravaux.toLocaleDateString("fr-FR") : "—"} →{" "}
              {dossier.dateFinTravaux ? dossier.dateFinTravaux.toLocaleDateString("fr-FR") : "—"}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Documents ({dossier.documents.length})</CardTitle>
        </CardHeader>
        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {dossier.documents.map((d) => (
            <div key={d.id}>{d.typeDocumentRef?.nom ?? d.nomFichier}</div>
          ))}
          {dossier.documents.length === 0 && <div className="text-slate-400">Aucun document.</div>}
        </div>
      </Card>
    </div>
  );
}
