"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Upload, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { previewLeadsCsv, commitLeadsCsvImport, type LeadCsvPreviewRow } from "./import-actions";

// ============================================================
// Assistant d'import CSV (P9, section 36 - finition) : upload -> aperçu
// (mapping colonnes détectées, erreurs, doublons potentiels) ->
// confirmation explicite ligne par ligne -> résultat. Aucune ligne
// invalide n'est jamais importée, même si elle reste cochée par erreur -
// commitLeadsCsvImport() la filtre de toute façon côté serveur.
// ============================================================

type Step = "upload" | "preview" | "result";

export function ImportLeadsWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadCsvPreviewRow[]>([]);
  const [unknownColumns, setUnknownColumns] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      startTransition(async () => {
        const r = await previewLeadsCsv(text);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setRows(r.rows);
        setUnknownColumns(r.unknownColumns);
        setSelected(new Set(r.rows.filter((row) => row.errors.length === 0 && row.duplicateOfIndex == null && !row.doublonExistant).map((row) => row.index)));
        setStep("preview");
      });
    };
    reader.readAsText(file, "utf-8");
  }

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function handleImport() {
    setError(null);
    const toImport = rows.filter((r) => selected.has(r.index));
    startTransition(async () => {
      const r = await commitLeadsCsvImport(toImport);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({ imported: r.imported, skipped: r.skipped });
      setStep("result");
    });
  }

  if (step === "upload") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>1. Choisir le fichier CSV</CardTitle>
        </CardHeader>
        <div className="space-y-3 p-5">
          {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-500 hover:border-emerald-300 hover:text-emerald-700">
            <Upload className="h-6 w-6" />
            <span>{isPending ? "Analyse en cours..." : "Cliquer pour choisir un fichier .csv"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
        </div>
      </Card>
    );
  }

  if (step === "preview") {
    return (
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
        {unknownColumns.length > 0 && (
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700">
            Colonne(s) non reconnue(s), ignorée(s) : {unknownColumns.join(", ")}
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle>2-5. Aperçu, mapping, erreurs, doublons potentiels</CardTitle>
          </CardHeader>
          <div className="space-y-1 p-5 text-xs text-slate-500">
            <p>{rows.length} ligne(s) lue(s) · {validRows.length} valide(s) · {rows.length - validRows.length} en erreur · {selected.size} sélectionnée(s) pour import.</p>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50/90 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Nom</th>
                  <th className="px-3 py-2">Prénom</th>
                  <th className="px-3 py-2">Téléphone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Ville</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(r.index)} disabled={r.errors.length > 0} onChange={() => toggleRow(r.index)} />
                    </td>
                    <td className="px-3 py-2">{r.nom}</td>
                    <td className="px-3 py-2">{r.prenom}</td>
                    <td className="px-3 py-2">{r.telephone ?? "—"}</td>
                    <td className="px-3 py-2">{r.email ?? "—"}</td>
                    <td className="px-3 py-2">{r.ville ?? "—"}</td>
                    <td className="px-3 py-2">{r.source ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.errors.length > 0 ? (
                        <Badge color="red">{r.errors.join(", ")}</Badge>
                      ) : r.duplicateOfIndex != null ? (
                        <Badge color="amber">Doublon (ligne {r.duplicateOfIndex})</Badge>
                      ) : r.doublonExistant ? (
                        <Badge color="amber">Doublon potentiel existant</Badge>
                      ) : (
                        <Badge color="emerald">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 border-t border-slate-100 p-5">
            <Button type="button" variant="secondary" onClick={() => setStep("upload")} disabled={isPending}>
              Recommencer
            </Button>
            <Button type="button" onClick={handleImport} disabled={isPending || selected.size === 0}>
              6. Importer {selected.size} lead(s) <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>7. Résultat de l&apos;import</CardTitle>
      </CardHeader>
      <div className="space-y-3 p-5 text-sm">
        <p>
          <strong>{result?.imported}</strong> lead(s) importé(s), <strong>{result?.skipped}</strong> ligne(s) ignorée(s) (erreur ou non sélectionnée).
        </p>
        <Link href="/leads">
          <Button>Voir les leads</Button>
        </Link>
      </div>
    </Card>
  );
}
