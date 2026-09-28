import { redirect, notFound } from "next/navigation";
import { requireUserContext } from "@/lib/authz";
import { getDemandeDetailForDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComplementForm } from "../ComplementForm";
import { PosteTechnique } from "@/components/dossier/PosteTechnique";

// P16 - vue détail STRICTEMENT restreinte au périmètre du donneur d'ordre :
// client/prestation/statut/documents qu'il a fournis. Jamais de marge,
// coût interne, sous-traitant assigné ou tout autre détail interne (même
// discipline que l'espace partenaire sous-traitant/délégataire CEE).
export default async function DemandeDetailPage({ params, searchParams }: { params: Promise<{ dossierId: string }>; searchParams: Promise<{ envoye?: string }> }) {
  const { dossierId } = await params;
  const { envoye } = await searchParams;
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
        <p className="mt-1 text-sm text-slate-500">
          {dossier.statut.label}
          {dossier.referenceDonneurOrdre ? ` · Votre réf. ${dossier.referenceDonneurOrdre}` : ""}
        </p>
      </div>

      {envoye === "1" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Demande bien reçue par nos équipes. Vous serez tenu informé ici de son avancement.
        </div>
      )}
      {dossier.motifRefusDonneurOrdre && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Demande non retenue : {dossier.motifRefusDonneurOrdre}</div>
      )}

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
            <div key={p.id} className="border-b border-slate-100 pb-2 last:border-0">
              <div className="font-medium text-slate-800">{typeTravauxLabels[p.type] ?? p.type}</div>
              <PosteTechnique p={p} />
            </div>
          ))}
          {dossier.infosTechniquesDonneurOrdre && (
            <div className="whitespace-pre-line pt-2 text-slate-500">{dossier.infosTechniquesDonneurOrdre}</div>
          )}
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
          <CardTitle>Vos documents ({dossier.documents.length})</CardTitle>
        </CardHeader>
        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {dossier.documents.map((d) => (
            <div key={d.id}>
              <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                {d.typeDocumentRef?.nom ?? d.nomFichier}
              </a>
            </div>
          ))}
          {dossier.documents.length === 0 && <div className="text-slate-400">Aucun document.</div>}
        </div>
      </Card>
    </div>
  );
}
