import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Plus, Trash2, Lock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { typeDocumentLabels, typeTacheLabels } from "@/lib/dossier-labels";
import {
  createEtapeProgramme,
  updateEtapeProgramme,
  deleteEtapeProgramme,
  reorderEtapeProgramme,
  setEtapeDependances,
  createModeleTacheEtape,
  deleteModeleTacheEtape,
  createDocumentRequis,
  deleteDocumentRequis,
  publierProgrammeVersion,
} from "../../../../programmes-actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";

const typeFluxLabels: Record<string, string> = {
  COMMERCIAL: "Commercial",
  ADMINISTRATIF: "Administratif",
  ANAH: "ANAH",
  CEE: "CEE",
  TRAVAUX: "Travaux",
  FINANCIER: "Financier",
  AUTRE: "Autre",
};

const roleLabels: Record<string, string> = {
  ADMIN: "Direction",
  COMMERCIAL: "Commercial",
  COMPTA: "Comptabilité",
  ADMINISTRATIF: "Administratif",
  REGIE: "Régie",
  SOUS_TRAITANT: "Sous-traitant",
  COMPTABILITE: "Comptabilité",
  TECHNIQUE: "Technique",
};

export default async function ProgrammeVersionDetailPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const { id, versionId } = await params;
  const ctx = await requireUserContext();

  const version = await prisma.programmeVersion.findFirst({
    where: { id: versionId, programmeId: id, programme: { organisationId: ctx.organisationId } },
    include: {
      programme: true,
      etapes: {
        include: {
          dependances: { include: { dependsOnEtape: { select: { id: true, nom: true } } } },
          modelesTaches: true,
          documentsRequis: true,
        },
        orderBy: { ordre: "asc" },
      },
    },
  });
  if (!version) notFound();

  const modifiable = !version.publie;

  return (
    <div className="space-y-6">
      <Link
        href={`/parametrage/programmes/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {version.programme.nom}
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            v{version.numeroVersion} {version.nomVersion && `· ${version.nomVersion}`}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{version.etapes.length} étape(s)</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge color={version.publie ? "emerald" : "slate"}>{version.publie ? "Publiée" : "Brouillon"}</Badge>
          {!version.publie && (
            <form action={async () => { "use server"; await publierProgrammeVersion(version.id); }}>
              <Button type="submit">Publier cette version</Button>
            </form>
          )}
        </div>
      </div>

      {!modifiable && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Lock className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Cette version est publiée et figée : sa structure (étapes, dépendances, tâches
            automatiques) ne peut plus être modifiée, pour que les dossiers déjà engagés ne
            changent jamais de comportement. Dupliquez-la depuis la page du programme pour faire
            évoluer ce parcours.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {version.etapes.map((etape, index) => (
          <Card key={etape.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <form
                action={modifiable ? updateEtapeProgramme.bind(null, etape.id) : undefined}
                className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4"
              >
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <label className={labelClass}>Nom</label>
                  <input name="nom" defaultValue={etape.nom} disabled={!modifiable} required className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Flux</label>
                  <select name="typeFlux" defaultValue={etape.typeFlux} disabled={!modifiable} className={inputClass}>
                    {Object.entries(typeFluxLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Responsable</label>
                  <select name="roleResponsable" defaultValue={etape.roleResponsable ?? ""} disabled={!modifiable} className={inputClass}>
                    <option value="">—</option>
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Délai normal (j)</label>
                  <input
                    name="delaiNormalJours"
                    type="number"
                    defaultValue={etape.delaiNormalJours ?? ""}
                    disabled={!modifiable}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Délai d&apos;alerte (j)</label>
                  <input
                    name="delaiAlerteJours"
                    type="number"
                    defaultValue={etape.delaiAlerteJours ?? ""}
                    disabled={!modifiable}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2 space-y-1 sm:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input name="description" defaultValue={etape.description ?? ""} disabled={!modifiable} className={inputClass} />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" name="obligatoire" defaultChecked={etape.obligatoire} disabled={!modifiable} />
                  Obligatoire
                </label>
                {modifiable && (
                  <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
                    <Button type="submit" variant="secondary" className="text-xs">
                      Enregistrer
                    </Button>
                  </div>
                )}
              </form>

              {modifiable && (
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span className="text-xs font-medium text-slate-400">{index + 1}</span>
                  <form action={reorderEtapeProgramme.bind(null, version.id, etape.id, "up")}>
                    <button type="submit" className="text-slate-300 hover:text-slate-700" aria-label="Monter">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  </form>
                  <form action={reorderEtapeProgramme.bind(null, version.id, etape.id, "down")}>
                    <button type="submit" className="text-slate-300 hover:text-slate-700" aria-label="Descendre">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </form>
                  <form action={async () => { "use server"; await deleteEtapeProgramme(etape.id); }}>
                    <button type="submit" className="text-slate-300 hover:text-red-600" aria-label="Supprimer">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Dépend de</p>
                <form action={setEtapeDependances.bind(null, etape.id)} className="space-y-1.5">
                  {version.etapes
                    .filter((autre) => autre.id !== etape.id)
                    .map((autre) => (
                      <label key={autre.id} className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          name="dependsOnEtapeId"
                          value={autre.id}
                          disabled={!modifiable}
                          defaultChecked={etape.dependances.some((d) => d.dependsOnEtapeId === autre.id)}
                        />
                        {autre.nom}
                      </label>
                    ))}
                  {version.etapes.length <= 1 && <p className="text-xs text-slate-400">Aucune autre étape.</p>}
                  {modifiable && (
                    <Button type="submit" variant="ghost" className="text-xs">
                      Enregistrer les dépendances
                    </Button>
                  )}
                </form>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tâches automatiques</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {etape.modelesTaches.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span>
                        {m.titre} <span className="text-slate-400">({typeTacheLabels[m.type]}, +{m.delaiJours}j)</span>
                      </span>
                      {modifiable && (
                        <form action={async () => { "use server"; await deleteModeleTacheEtape(m.id); }}>
                          <button type="submit" className="text-slate-300 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                  {etape.modelesTaches.length === 0 && <p className="text-slate-400">Aucune.</p>}
                </ul>
                {modifiable && (
                  <form action={createModeleTacheEtape} className="space-y-1.5">
                    <input type="hidden" name="etapeProgrammeId" value={etape.id} />
                    <input name="titre" placeholder="Titre de la tâche" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                    <div className="flex gap-1.5">
                      <input
                        name="delaiJours"
                        type="number"
                        placeholder="Délai (j)"
                        className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />
                      <button type="submit" className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                        <Plus className="inline h-3 w-3" /> Ajouter
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Documents requis</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {etape.documentsRequis.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span>{typeDocumentLabels[d.typeDocument]}</span>
                      {modifiable && (
                        <form action={async () => { "use server"; await deleteDocumentRequis(d.id); }}>
                          <button type="submit" className="text-slate-300 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                  {etape.documentsRequis.length === 0 && <p className="text-slate-400">Aucun.</p>}
                </ul>
                {modifiable && (
                  <form action={createDocumentRequis} className="flex gap-1.5">
                    <input type="hidden" name="etapeProgrammeId" value={etape.id} />
                    <select name="typeDocument" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs">
                      {Object.entries(typeDocumentLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                      <Plus className="h-3 w-3" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          </Card>
        ))}

        {version.etapes.length === 0 && (
          <p className="text-sm text-slate-400">Aucune étape pour l&apos;instant.</p>
        )}
      </div>

      {modifiable && (
        <form action={createEtapeProgramme} className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
          <h3 className="text-sm font-semibold text-slate-900">Ajouter une étape</h3>
          <input type="hidden" name="programmeVersionId" value={version.id} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <label className={labelClass}>Nom</label>
              <input name="nom" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Flux</label>
              <select name="typeFlux" defaultValue="AUTRE" className={inputClass}>
                {Object.entries(typeFluxLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Responsable</label>
              <select name="roleResponsable" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Délai normal (j)</label>
              <input name="delaiNormalJours" type="number" className={inputClass} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-xs text-slate-600 sm:col-span-4">
              <input type="checkbox" name="obligatoire" defaultChecked />
              Obligatoire
            </label>
          </div>
          <Button type="submit">
            <Plus className="h-4 w-4" />
            Ajouter l&apos;étape
          </Button>
        </form>
      )}
    </div>
  );
}
