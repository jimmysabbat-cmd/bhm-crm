"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { getDossierDocumentsAction, envoyerEnMissionAction } from "./mission-actions";

type SousTraitant = { id: string; nom: string };
type Regie = { id: string; nom: string };
type DocRow = { id: string; nomFichier: string; typeNom: string | null };

const CHAMPS_CLIENT: { key: "nom" | "prenom" | "telephone" | "email" | "adresse"; label: string }[] = [
  { key: "nom", label: "Nom" },
  { key: "prenom", label: "Prénom" },
  { key: "telephone", label: "Téléphone" },
  { key: "email", label: "Email" },
  { key: "adresse", label: "Adresse" },
];

export function EnvoyerEnMissionButton({
  dossierId,
  posteTravauxId,
  sousTraitants,
  regies,
  posteLabel,
}: {
  dossierId: string;
  posteTravauxId: string;
  sousTraitants: SousTraitant[];
  regies: Regie[];
  posteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [destinataireType, setDestinataireType] = useState<"SOUS_TRAITANT" | "REGIE">("SOUS_TRAITANT");
  const [sousTraitantId, setSousTraitantId] = useState("");
  const [regieId, setRegieId] = useState("");
  const [champs, setChamps] = useState<Record<string, boolean>>({ nom: true, prenom: true, adresse: true });
  const [docIds, setDocIds] = useState<Set<string>>(new Set());
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [instructions, setInstructions] = useState("");
  const [prix, setPrix] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      getDossierDocumentsAction(dossierId).then(setDocs).catch(() => setDocs([]));
    }
  }, [open, dossierId]);

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="text-xs" onClick={() => setOpen(true)}>
        Envoyer en mission
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-900">Envoyer en mission — {posteLabel}</h2>

        {done ? (
          <div className="mt-4 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">Mission envoyée avec succès.</div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Destinataire</label>
              <div className="mt-1 flex gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="destinataireType"
                    checked={destinataireType === "SOUS_TRAITANT"}
                    onChange={() => {
                      setDestinataireType("SOUS_TRAITANT");
                      setRegieId("");
                    }}
                  />
                  Sous-traitant
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="destinataireType"
                    checked={destinataireType === "REGIE"}
                    onChange={() => {
                      setDestinataireType("REGIE");
                      setSousTraitantId("");
                    }}
                  />
                  Équipe interne
                </label>
              </div>
              {destinataireType === "SOUS_TRAITANT" ? (
                <select value={sousTraitantId} onChange={(e) => setSousTraitantId(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">— Choisir un sous-traitant —</option>
                  {sousTraitants.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={regieId} onChange={(e) => setRegieId(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">— Choisir une équipe interne —</option>
                  {regies.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nom}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Informations client à partager</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {CHAMPS_CLIENT.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={!!champs[c.key]} onChange={(e) => setChamps((prev) => ({ ...prev, [c.key]: e.target.checked }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Date début souhaitée</label>
                <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Date fin souhaitée</label>
                <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Prix convenu (€)</label>
              <input type="number" step="0.01" value={prix} onChange={(e) => setPrix(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Instructions / commentaires</label>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Documents à transmettre</label>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {docs.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={docIds.has(d.id)}
                      onChange={(e) =>
                        setDocIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          return next;
                        })
                      }
                    />
                    {d.typeNom ?? d.nomFichier}
                  </label>
                ))}
                {docs.length === 0 && <div className="text-xs text-slate-400">Aucun document dans ce dossier.</div>}
              </div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                disabled={(!sousTraitantId && !regieId) || pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const res = await envoyerEnMissionAction({
                      dossierId,
                      posteTravauxId,
                      sousTraitantId: sousTraitantId || null,
                      regieId: regieId || null,
                      champsPartages: champs,
                      documentIds: Array.from(docIds),
                      dateDebutSouhaitee: dateDebut || null,
                      dateFinSouhaitee: dateFin || null,
                      instructions: instructions || null,
                      prixConvenuCts: prix ? Math.round(Number.parseFloat(prix) * 100) : null,
                    });
                    if (!res.ok) setError(res.error);
                    else setDone(true);
                  })
                }
              >
                Envoyer
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
