import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import {
  precariteLabels,
  resteAChargeCents,
  typeTacheLabels,
  typeTravauxLabels,
  typeDocumentLabels,
} from "@/lib/dossier-labels";
import {
  createTache,
  updateEncaissements,
  updateMontage,
  updateStatut,
  updateAnahInfo,
  toggleTache,
  createPosteTravaux,
  updatePosteTravaux,
  deletePosteTravaux,
  uploadDocument,
  deleteDocument,
} from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const labelClass = "text-sm font-medium text-neutral-700";

function dateInputValue(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function DossierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [dossier, statuts, mars, statutsAnah, sousTraitants, regies, delegatairesCee] =
    await Promise.all([
      prisma.dossier.findUnique({
        where: { id },
        include: {
          client: true,
          type: true,
          statut: true,
          modePaiementAide: true,
          mar: true,
          statutAnah: true,
          delegataireCee: true,
          taches: { orderBy: { dateEcheance: "asc" } },
          postesTravaux: {
            orderBy: { createdAt: "asc" },
            include: { sousTraitant: true, regie: true },
          },
          documents: { orderBy: { createdAt: "desc" } },
        },
      }),
      prisma.dossierStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      prisma.mar.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      prisma.statutAnah.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      prisma.sousTraitant.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
      prisma.regie.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      prisma.delegataireCee.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    ]);

  if (!dossier) notFound();

  const resteACharge = resteAChargeCents(dossier);
  const isRenoAmpleur = dossier.type.key.startsWith("RENOVATION_AMPLEUR");

  const totalAides = dossier.montantAideMPR + dossier.montantAideCEE;
  const resteAPercevoirClient = resteACharge - dossier.montantEncaisseClient;
  const resteAPercevoirMPR = dossier.montantAideMPR - dossier.montantEncaisseMPR;
  const resteAPercevoirCEE = dossier.montantAideCEE - dossier.montantEncaisseCEE;

  const totalMateriel = dossier.postesTravaux.reduce(
    (sum, p) => sum + (p.montantMaterielTTCCts ?? p.montantMaterielHTCts ?? 0),
    0
  );
  const totalSousTraitance = dossier.postesTravaux.reduce(
    (sum, p) => sum + (p.montantPoseSousTraitanceCts ?? 0),
    0
  );
  const totalRegie = dossier.postesTravaux.reduce((sum, p) => sum + (p.montantRegieCts ?? 0), 0);
  const totalCoutsChantier = totalMateriel + totalSousTraitance + totalRegie;
  const margeNette = dossier.montantDevisTTC - totalCoutsChantier;

  const dusParSousTraitant = new Map<
    string,
    { nom: string; montant: number; delaiPaiementJours: number | null }
  >();
  for (const p of dossier.postesTravaux) {
    if (p.sousTraitant && p.montantPoseSousTraitanceCts) {
      const existing = dusParSousTraitant.get(p.sousTraitant.id);
      if (existing) existing.montant += p.montantPoseSousTraitanceCts;
      else
        dusParSousTraitant.set(p.sousTraitant.id, {
          nom: p.sousTraitant.nom,
          montant: p.montantPoseSousTraitanceCts,
          delaiPaiementJours: p.sousTraitant.delaiPaiementJours,
        });
    }
  }

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
                <dd>{dossier.mar.nom}</dd>
              </div>
            )}
            {dossier.delegataireCee && (
              <div className="flex justify-between">
                <dt>Délégataire CEE</dt>
                <dd>{dossier.delegataireCee.nom}</dd>
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

        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Montage financier</h2>
          <form action={updateMontage} className="space-y-2">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-neutral-500">Devis TTC</label>
              <input
                name="montantDevisTTC"
                type="number"
                step="0.01"
                defaultValue={dossier.montantDevisTTC / 100}
                className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-neutral-500">Aide MPR / ANAH</label>
              <input
                name="montantAideMPR"
                type="number"
                step="0.01"
                defaultValue={dossier.montantAideMPR / 100}
                className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-neutral-500">Aide CEE</label>
              <input
                name="montantAideCEE"
                type="number"
                step="0.01"
                defaultValue={dossier.montantAideCEE / 100}
                className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-between border-t border-neutral-100 pt-2 text-sm font-semibold text-neutral-900">
              <span>Reste à charge client</span>
              <span>{formatCents(resteACharge)}</span>
            </div>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Enregistrer
            </button>
          </form>
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
          <div className="space-y-1">
            <label className={labelClass}>Délégataire CEE</label>
            <select name="delegataireCeeId" defaultValue={dossier.delegataireCeeId ?? ""} className={inputClass}>
              <option value="">—</option>
              {delegatairesCee.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
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

      {isRenoAmpleur && (
        <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-900">Suivi ANAH</h2>
          <form action={updateAnahInfo} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="space-y-1">
              <label className={labelClass}>MAR</label>
              <select name="marId" defaultValue={dossier.marId ?? ""} className={inputClass}>
                <option value="">—</option>
                {mars.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Statut ANAH</label>
              <select name="statutAnahId" defaultValue={dossier.statutAnahId ?? ""} className={inputClass}>
                <option value="">—</option>
                {statutsAnah.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Date de dépôt ANAH</label>
              <input
                name="dateDepotAnah"
                type="date"
                defaultValue={dateInputValue(dossier.dateDepotAnah)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Date d&apos;octroi ANAH</label>
              <input
                name="dateOctroiAnah"
                type="date"
                defaultValue={dateInputValue(dossier.dateOctroiAnah)}
                className={inputClass}
              />
            </div>
            <div className="col-span-2 flex items-end sm:col-span-4">
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Finances du dossier</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <dl className="space-y-1 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-neutral-400">Reste à percevoir</p>
            <Row label="Côté client" value={formatCents(resteAPercevoirClient)} />
            <Row label="Côté MPR" value={formatCents(resteAPercevoirMPR)} />
            <Row label="Côté CEE" value={formatCents(resteAPercevoirCEE)} />
            <Row label="Total aides prévues" value={formatCents(totalAides)} />
          </dl>
          <dl className="space-y-1 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-neutral-400">Coûts chantier</p>
            <Row label="Matériel" value={formatCents(totalMateriel)} />
            <Row label="Sous-traitance" value={formatCents(totalSousTraitance)} />
            <Row label="Régie" value={formatCents(totalRegie)} />
            <Row label="Total coûts" value={formatCents(totalCoutsChantier)} />
          </dl>
          <dl className="space-y-1 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-neutral-400">Rentabilité</p>
            <Row label="Devis TTC" value={formatCents(dossier.montantDevisTTC)} />
            <Row label="Total coûts" value={formatCents(totalCoutsChantier)} />
            <Row label="Marge nette" value={formatCents(margeNette)} strong />
          </dl>
        </div>

        {dusParSousTraitant.size > 0 && (
          <div className="border-t border-neutral-100 pt-4">
            <p className="mb-2 text-xs font-medium uppercase text-neutral-400">
              Montant dû aux sous-traitants
            </p>
            <ul className="space-y-1 text-sm">
              {Array.from(dusParSousTraitant.values()).map((d) => {
                const echeance =
                  dossier.dateFinTravaux && d.delaiPaiementJours
                    ? addDays(dossier.dateFinTravaux, d.delaiPaiementJours)
                    : null;
                return (
                  <li key={d.nom} className="flex justify-between text-neutral-700">
                    <span>
                      {d.nom}
                      {d.delaiPaiementJours ? ` (délai ${d.delaiPaiementJours} j${echeance ? `, échéance ${echeance.toLocaleDateString("fr-FR")}` : ""})` : ""}
                    </span>
                    <span className="font-medium">{formatCents(d.montant)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Postes de travaux</h2>

        <div className="space-y-4">
          {dossier.postesTravaux.map((poste) => (
            <form
              key={poste.id}
              action={updatePosteTravaux.bind(null, poste.id)}
              className="space-y-3 rounded-md border border-neutral-100 p-4"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <label className={labelClass}>Type de travaux</label>
                  <select name="type" defaultValue={poste.type} className={inputClass}>
                    {Object.entries(typeTravauxLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Surface (m²)</label>
                  <input
                    name="surfaceM2"
                    type="number"
                    step="0.01"
                    defaultValue={poste.surfaceM2 ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>CUMAC (kWh)</label>
                  <input
                    name="montantCumac"
                    type="number"
                    defaultValue={poste.montantCumac ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Prime calculée (€)</label>
                  <input
                    name="montantPrimeCalcule"
                    type="number"
                    step="0.01"
                    defaultValue={poste.montantPrimeCalculeCts ? poste.montantPrimeCalculeCts / 100 : ""}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Sous-traitant</label>
                  <select name="sousTraitantId" defaultValue={poste.sousTraitantId ?? ""} className={inputClass}>
                    <option value="">—</option>
                    {sousTraitants.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Montant pose sous-traitance (€)</label>
                  <input
                    name="montantPoseSousTraitance"
                    type="number"
                    step="0.01"
                    defaultValue={
                      poste.montantPoseSousTraitanceCts ? poste.montantPoseSousTraitanceCts / 100 : ""
                    }
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Régie</label>
                  <select name="regieId" defaultValue={poste.regieId ?? ""} className={inputClass}>
                    <option value="">—</option>
                    {regies.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Montant pose régie (€)</label>
                  <input
                    name="montantRegie"
                    type="number"
                    step="0.01"
                    defaultValue={poste.montantRegieCts ? poste.montantRegieCts / 100 : ""}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Matériel HT (€)</label>
                  <input
                    name="montantMaterielHT"
                    type="number"
                    step="0.01"
                    defaultValue={poste.montantMaterielHTCts ? poste.montantMaterielHTCts / 100 : ""}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Matériel TTC (€)</label>
                  <input
                    name="montantMaterielTTC"
                    type="number"
                    step="0.01"
                    defaultValue={poste.montantMaterielTTCCts ? poste.montantMaterielTTCCts / 100 : ""}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800"
                >
                  Enregistrer
                </button>
                <button
                  type="submit"
                  formAction={async () => {
                    "use server";
                    await deletePosteTravaux(poste.id, dossier.id);
                  }}
                  className="rounded-md px-3 py-2 text-xs font-medium text-neutral-500 hover:text-red-600"
                >
                  Supprimer
                </button>
              </div>
            </form>
          ))}
          {dossier.postesTravaux.length === 0 && (
            <p className="text-sm text-neutral-400">Aucun poste de travaux.</p>
          )}
        </div>

        <form
          action={createPosteTravaux}
          className="space-y-3 border-t border-neutral-100 pt-4"
        >
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className={labelClass}>Type de travaux</label>
              <select name="type" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir...
                </option>
                {Object.entries(typeTravauxLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Surface (m²)</label>
              <input name="surfaceM2" type="number" step="0.01" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>CUMAC (kWh)</label>
              <input name="montantCumac" type="number" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Prime calculée (€)</label>
              <input name="montantPrimeCalcule" type="number" step="0.01" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Sous-traitant</label>
              <select name="sousTraitantId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {sousTraitants.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Montant pose sous-traitance (€)</label>
              <input name="montantPoseSousTraitance" type="number" step="0.01" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Régie</label>
              <select name="regieId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {regies.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Montant pose régie (€)</label>
              <input name="montantRegie" type="number" step="0.01" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Matériel HT (€)</label>
              <input name="montantMaterielHT" type="number" step="0.01" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Matériel TTC (€)</label>
              <input name="montantMaterielTTC" type="number" step="0.01" className={inputClass} />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + Ajouter un poste
          </button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Documents & photos</h2>

        <ul className="space-y-2">
          {dossier.documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 text-sm">
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-800 hover:underline"
              >
                {doc.nomFichier}
              </a>
              <span className="text-xs text-neutral-400">{typeDocumentLabels[doc.type]}</span>
              <span className="text-xs text-neutral-400">
                {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
              </span>
              <form
                action={async () => {
                  "use server";
                  await deleteDocument(doc.id, dossier.id);
                }}
                className="ml-auto"
              >
                <button type="submit" className="text-xs text-neutral-400 hover:text-red-600">
                  Supprimer
                </button>
              </form>
            </li>
          ))}
          {dossier.documents.length === 0 && (
            <p className="text-sm text-neutral-400">Aucun document.</p>
          )}
        </ul>

        <form
          action={uploadDocument}
          encType="multipart/form-data"
          className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4"
        >
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="space-y-1">
            <label className={labelClass}>Type</label>
            <select name="type" className={inputClass} defaultValue="DEVIS">
              {Object.entries(typeDocumentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Fichier</label>
            <input name="file" type="file" required className={inputClass} />
          </div>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Téléverser
          </button>
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
