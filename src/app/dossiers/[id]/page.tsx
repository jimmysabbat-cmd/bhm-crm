import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import { precariteLabels, resteAChargeCents, typeTacheLabels } from "@/lib/dossier-labels";
import { createTache, updateEncaissements, updateStatut, toggleTache } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const labelClass = "text-sm font-medium text-neutral-700";

function dateInputValue(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export default async function DossierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [dossier, statuts] = await Promise.all([
    prisma.dossier.findUnique({
      where: { id },
      include: {
        client: true,
        type: true,
        statut: true,
        modePaiementAide: true,
        taches: { orderBy: { dateEcheance: "asc" } },
      },
    }),
    prisma.dossierStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
  ]);

  if (!dossier) notFound();

  const resteACharge = resteAChargeCents(dossier);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div>
        <p className="text-sm text-neutral-400">{dossier.reference}</p>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {dossier.client.prenom} {dossier.client.nom}
        </h1>
        <p className="text-sm text-neutral-500">{dossier.type.label}</p>
      </div>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Statut</h2>
          <form
            action={async (formData: FormData) => {
              "use server";
              await updateStatut(dossier.id, String(formData.get("statutId")));
            }}
            className="flex gap-2"
          >
            <select name="statutId" defaultValue={dossier.statutId} className={inputClass}>
              {statuts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              OK
            </button>
          </form>

          <dl className="space-y-1 text-sm text-neutral-600">
            {dossier.modePaiementAide && (
              <div className="flex justify-between">
                <dt>Mode paiement aide</dt>
                <dd>{dossier.modePaiementAide.label}</dd>
              </div>
            )}
            {dossier.mar && (
              <div className="flex justify-between">
                <dt>MAR</dt>
                <dd>{dossier.mar}</dd>
              </div>
            )}
            {dossier.delegataireCEE && (
              <div className="flex justify-between">
                <dt>Délégataire CEE</dt>
                <dd>{dossier.delegataireCEE}</dd>
              </div>
            )}
            {dossier.client.precarite && (
              <div className="flex justify-between">
                <dt>Précarité</dt>
                <dd>{precariteLabels[dossier.client.precarite]}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Montage financier</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Devis TTC" value={formatCents(dossier.montantDevisTTC)} />
            <Row label="Aide MPR / ANAH" value={formatCents(dossier.montantAideMPR)} />
            <Row label="Aide CEE" value={formatCents(dossier.montantAideCEE)} />
            <Row label="Reste à charge client" value={formatCents(resteACharge)} strong />
          </dl>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Encaissements & dates chantier</h2>
        <form action={updateEncaissements} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="space-y-1">
            <label className={labelClass}>Encaissé client (€)</label>
            <input
              name="montantEncaisseClient"
              type="number"
              step="0.01"
              defaultValue={dossier.montantEncaisseClient / 100}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Encaissé MPR (€)</label>
            <input
              name="montantEncaisseMPR"
              type="number"
              step="0.01"
              defaultValue={dossier.montantEncaisseMPR / 100}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Encaissé CEE (€)</label>
            <input
              name="montantEncaisseCEE"
              type="number"
              step="0.01"
              defaultValue={dossier.montantEncaisseCEE / 100}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Début travaux</label>
            <input
              name="dateDebutTravaux"
              type="date"
              defaultValue={dateInputValue(dossier.dateDebutTravaux)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Fin travaux</label>
            <input
              name="dateFinTravaux"
              type="date"
              defaultValue={dateInputValue(dossier.dateFinTravaux)}
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Tâches & relances</h2>

        <ul className="space-y-2">
          {dossier.taches.map((t) => (
            <li key={t.id} className="flex items-center gap-3 text-sm">
              <form
                action={async () => {
                  "use server";
                  await toggleTache(t.id, t.statut !== "FAIT");
                }}
              >
                <button
                  type="submit"
                  className={`h-4 w-4 rounded border ${
                    t.statut === "FAIT"
                      ? "border-neutral-900 bg-neutral-900"
                      : "border-neutral-300"
                  }`}
                  aria-label="Basculer statut"
                />
              </form>
              <span className={t.statut === "FAIT" ? "text-neutral-400 line-through" : "text-neutral-800"}>
                {t.titre}
              </span>
              <span className="text-xs text-neutral-400">{typeTacheLabels[t.type]}</span>
              <span className="ml-auto text-xs text-neutral-400">
                {new Date(t.dateEcheance).toLocaleDateString("fr-FR")}
              </span>
            </li>
          ))}
          {dossier.taches.length === 0 && (
            <p className="text-sm text-neutral-400">Aucune tâche.</p>
          )}
        </ul>

        <form action={createTache} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4">
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="space-y-1">
            <label className={labelClass}>Titre</label>
            <input name="titre" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Type</label>
            <select name="type" className={inputClass} defaultValue="RELANCE_CLIENT">
              {Object.entries(typeTacheLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Échéance</label>
            <input name="dateEcheance" type="date" required className={inputClass} />
          </div>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Ajouter
          </button>
        </form>
      </section>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={strong ? "font-semibold text-neutral-900" : "text-neutral-700"}>{value}</dd>
    </div>
  );
}
