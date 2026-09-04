"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck, ShieldAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { smallInputClass } from "@/components/ui/field";
import { uploadDossierDocument, validateDossierDocument, refuseDossierDocument, replaceDossierDocument, getDocumentRelanceData, enregistrerRelanceDocuments } from "./document-actions";
import { previewTransmissionPackageAction, createTransmissionPackageAction, markTransmissionPackagePret, markTransmissionPackageTransmis, cancelTransmissionPackage } from "./package-actions";
import type { TransmissionPackagePreview } from "@/lib/documents/transmission";
import type { RelanceDocumentaireData } from "@/lib/documents/relance";

// ============================================================
// Bloc "CHECKLIST DOCUMENTAIRE" (P10, section 27) - complète la fiche
// dossier SANS la refondre : une nouvelle Card autonome, même convention
// visuelle que EtudeStudyPanel (P8).
// ============================================================

const STATUS_COLOR: Record<string, "slate" | "blue" | "amber" | "emerald" | "red"> = {
  MANQUANT: "slate",
  FOURNI: "blue",
  A_VERIFIER: "amber",
  VALIDE: "emerald",
  REFUSE: "red",
  EXPIRE: "red",
};
const STATUS_LABEL: Record<string, string> = {
  MANQUANT: "Manquant",
  FOURNI: "Fourni",
  A_VERIFIER: "À vérifier",
  VALIDE: "Validé",
  REFUSE: "Refusé",
  EXPIRE: "Expiré",
};

export type ChecklistRequirementProp = {
  requirementId: string;
  typeDocumentId: string;
  typeDocumentCode: string;
  typeDocumentNom: string;
  required: boolean;
  status: string;
  sourceRequirementLabel: string;
  providedDocuments: { id: string; nomFichier: string; statut: string; expired: boolean; version: number }[];
  responsible: string | null;
  destination: string | null;
  blocking: boolean;
};

export type TransmissionPackageProp = {
  id: string;
  destinationType: string;
  destinationName: string | null;
  status: string;
  createdAt: string;
  documentsCount: number;
};

export function DocumentChecklistPanel(props: {
  dossierId: string;
  completionPct: number;
  blockingCount: number;
  requirements: ChecklistRequirementProp[];
  destinations: string[];
  packages: TransmissionPackageProp[];
  permissions: { peutUpload: boolean; peutValider: boolean; peutCreerPackage: boolean; peutTelechargerPackage: boolean };
}) {
  const { dossierId, completionPct, blockingCount, requirements, destinations, packages, permissions } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refusingId, setRefusingId] = useState<string | null>(null);
  const [refuseReason, setRefuseReason] = useState("");
  const [selectedDestination, setSelectedDestination] = useState(destinations[0] ?? "");
  const [preview, setPreview] = useState<TransmissionPackagePreview | null>(null);
  const [relance, setRelance] = useState<RelanceDocumentaireData | null>(null);

  function handleUpload(requirementId: string, formData: FormData) {
    setError(null);
    formData.set("dossierId", dossierId);
    formData.set("requirementId", requirementId);
    startTransition(async () => {
      const r = await uploadDossierDocument(formData);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleReplace(oldDocId: string, formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await replaceDossierDocument(oldDocId, formData);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleValidate(docId: string) {
    setError(null);
    startTransition(async () => {
      const r = await validateDossierDocument(docId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleRefuse(docId: string) {
    setError(null);
    startTransition(async () => {
      const r = await refuseDossierDocument(docId, refuseReason);
      if (!r.ok) setError(r.error);
      else {
        setRefusingId(null);
        setRefuseReason("");
        router.refresh();
      }
    });
  }

  function handlePreview() {
    if (!selectedDestination) return;
    setError(null);
    startTransition(async () => {
      const r = await previewTransmissionPackageAction(dossierId, selectedDestination as never);
      if (!r.ok) setError(r.error);
      else setPreview(r.preview);
    });
  }

  function handleCreatePackage() {
    if (!selectedDestination) return;
    setError(null);
    startTransition(async () => {
      const r = await createTransmissionPackageAction(dossierId, selectedDestination as never, null, null);
      if (!r.ok) setError(r.error);
      else {
        setPreview(null);
        router.refresh();
      }
    });
  }

  function handleShowRelance() {
    setError(null);
    startTransition(async () => {
      const r = await getDocumentRelanceData(dossierId);
      if (!r.ok) setError(r.error);
      else setRelance(r.data);
    });
  }

  function handleEnregistrerRelance() {
    startTransition(async () => {
      const r = await enregistrerRelanceDocuments(dossierId);
      if (!r.ok) setError(r.error);
      else {
        setRelance(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-emerald-600" />
          <CardTitle>Checklist documentaire</CardTitle>
          <Badge color={completionPct === 100 ? "emerald" : "amber"}>{completionPct} %</Badge>
          {blockingCount > 0 && <Badge color="red">{blockingCount} bloquant(s)</Badge>}
        </div>
        {permissions.peutUpload && (
          <Button type="button" variant="secondary" className="text-xs" onClick={handleShowRelance} disabled={isPending}>
            Relancer pour pièces manquantes
          </Button>
        )}
      </CardHeader>

      <div className="space-y-4 p-5">
        {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}

        {relance && (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs">
            <p className="font-medium text-amber-800">
              {relance.documentsManquants.length} pièce(s) manquante(s) côté client - {relance.clientNom}
            </p>
            <ul className="list-disc pl-4 text-amber-700">
              {relance.documentsManquants.map((d) => (
                <li key={d.typeDocumentNom}>{d.typeDocumentNom}</li>
              ))}
            </ul>
            <p className="text-slate-500">
              {relance.relanceCount} relance(s) déjà enregistrée(s){relance.lastRelanceAt ? ` · dernière le ${new Date(relance.lastRelanceAt).toLocaleDateString("fr-FR")}` : ""}.
            </p>
            <Button type="button" variant="secondary" className="text-xs" onClick={handleEnregistrerRelance} disabled={isPending}>
              Enregistrer cette relance
            </Button>
          </div>
        )}

        {requirements.length === 0 && <p className="text-sm text-slate-400">Aucune exigence documentaire configurée pour ce dossier.</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-1 pr-3">Pièce</th>
                <th className="py-1 pr-3">Statut</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1 pr-3">Responsable</th>
                <th className="py-1 pr-3">Destination</th>
                <th className="py-1 pr-3">Bloquant</th>
                <th className="py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((r) => {
                const actif = r.providedDocuments.find((d) => d.statut !== "REMPLACE");
                return (
                  <tr key={r.requirementId} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3">
                      {r.typeDocumentNom}
                      {r.required && <span className="text-red-500"> *</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge color={STATUS_COLOR[r.status] ?? "slate"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{r.sourceRequirementLabel}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{r.responsible ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{r.destination ?? "—"}</td>
                    <td className="py-1.5 pr-3">{r.blocking ? <Badge color="red">Oui</Badge> : "—"}</td>
                    <td className="py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {actif && permissions.peutValider && actif.statut !== "VALIDE" && (
                          <Button type="button" variant="ghost" className="text-xs" onClick={() => handleValidate(actif.id)} disabled={isPending}>
                            Valider
                          </Button>
                        )}
                        {actif && permissions.peutValider && actif.statut !== "REFUSE" && refusingId !== actif.id && (
                          <Button type="button" variant="ghost" className="text-xs text-red-600" onClick={() => setRefusingId(actif.id)} disabled={isPending}>
                            Refuser
                          </Button>
                        )}
                        {actif && refusingId === actif.id && (
                          <span className="flex items-center gap-1">
                            <input value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)} placeholder="Motif" className={smallInputClass} />
                            <Button type="button" variant="danger" className="text-xs" onClick={() => handleRefuse(actif.id)} disabled={isPending || !refuseReason.trim()}>
                              OK
                            </Button>
                          </span>
                        )}
                        {actif && permissions.peutUpload && (
                          <form action={(fd) => handleReplace(actif.id, fd)} className="flex items-center gap-1">
                            <input type="file" name="file" required className="w-32 text-xs" />
                            <Button type="submit" variant="ghost" className="text-xs" disabled={isPending}>
                              Remplacer
                            </Button>
                          </form>
                        )}
                        {!actif && permissions.peutUpload && (
                          <form action={(fd) => handleUpload(r.requirementId, fd)} className="flex items-center gap-1">
                            <input type="file" name="file" required className="w-32 text-xs" />
                            <Button type="submit" variant="secondary" className="text-xs" disabled={isPending}>
                              Uploader
                            </Button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {permissions.peutCreerPackage && destinations.length > 0 && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Packages de transmission</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={selectedDestination} onChange={(e) => setSelectedDestination(e.target.value)} className={smallInputClass}>
                {destinations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" className="text-xs" onClick={handlePreview} disabled={isPending}>
                Aperçu
              </Button>
              <Button type="button" className="text-xs" onClick={handleCreatePackage} disabled={isPending}>
                Créer le package
              </Button>
            </div>

            {preview && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                <p className="font-medium text-slate-700">Inclus ({preview.included.length})</p>
                <ul className="text-slate-600">
                  {preview.included.map((d) => (
                    <li key={d.dossierDocumentId}>{d.typeDocumentNom} — {d.nomFichier}</li>
                  ))}
                </ul>
                {preview.excluded.length > 0 && (
                  <>
                    <p className="font-medium text-amber-700">Exclus ({preview.excluded.length})</p>
                    <ul className="text-amber-700">
                      {preview.excluded.map((d) => (
                        <li key={d.dossierDocumentId}>
                          {d.typeDocumentNom} — {d.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {preview.missingDocuments.length > 0 && <p className="text-red-600">Manquant(s) : {preview.missingDocuments.join(", ")}</p>}
                {preview.warnings.map((w) => (
                  <p key={w} className="flex items-center gap-1 text-amber-700">
                    <ShieldAlert className="h-3 w-3" /> {w}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              {packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs">
                  <span>
                    {p.destinationType} · {p.documentsCount} pièce(s) · {new Date(p.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge color={p.status === "TRANSMIS" ? "emerald" : p.status === "PRET" ? "blue" : p.status === "ANNULE" ? "slate" : "amber"}>{p.status}</Badge>
                    {p.status === "BROUILLON" && permissions.peutCreerPackage && (
                      <Button type="button" variant="ghost" className="text-xs" onClick={() => startTransition(async () => { await markTransmissionPackagePret(p.id); router.refresh(); })} disabled={isPending}>
                        Marquer prêt
                      </Button>
                    )}
                    {p.status === "PRET" && permissions.peutCreerPackage && (
                      <Button type="button" variant="ghost" className="text-xs" onClick={() => startTransition(async () => { await markTransmissionPackageTransmis(p.id, null, null); router.refresh(); })} disabled={isPending}>
                        Marquer transmis
                      </Button>
                    )}
                    {(p.status === "BROUILLON" || p.status === "PRET") && permissions.peutCreerPackage && (
                      <Button type="button" variant="ghost" className="text-xs text-red-600" onClick={() => startTransition(async () => { await cancelTransmissionPackage(p.id); router.refresh(); })} disabled={isPending}>
                        Annuler
                      </Button>
                    )}
                    {permissions.peutTelechargerPackage && (
                      <a href={`/api/transmission-packages/${p.id}/zip`} className="font-medium text-emerald-700 hover:underline">
                        ZIP
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {packages.length === 0 && <p className="text-xs text-slate-400">Aucun package créé pour ce dossier.</p>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
