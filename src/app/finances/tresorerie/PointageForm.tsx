"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { pointerPaiementsAction } from "./actions";

export type LignePointable = {
  id: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  categorieLabel: string;
  resteCts: number;
  echeance: string | null;
  echeanceEstimee: boolean;
  enRetard: boolean;
  virtuelle: boolean;
  factureId: string | null;
};

const eur = (cts: number) => (cts / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function parseEuros(v: string): number {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Pointage d'un paiement reçu (ou versé) sur une contrepartie : saisir le
// montant total du virement, il est réparti automatiquement sur les lignes
// les plus anciennes (modifiable ligne par ligne) - un seul virement ANAH ou
// délégataire peut ainsi solder plusieurs dossiers d'un coup.
export function PointageForm({ sens, cpNom, lignes, peutPointer }: { sens: "ENTREE" | "SORTIE"; cpNom: string; lignes: LignePointable[]; peutPointer: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [mode, setMode] = useState("VIREMENT");
  const [reference, setReference] = useState("");
  const [total, setTotal] = useState("");
  const [montants, setMontants] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const affecteCts = useMemo(() => lignes.reduce((s, l) => s + parseEuros(montants[l.id] ?? ""), 0), [lignes, montants]);
  const totalCts = parseEuros(total);

  function repartir(v: string) {
    setTotal(v);
    let reste = parseEuros(v);
    const next: Record<string, string> = {};
    for (const l of lignes) {
      const part = Math.min(reste, l.resteCts);
      next[l.id] = part > 0 ? (part / 100).toFixed(2).replace(".", ",") : "";
      reste -= part;
    }
    setMontants(next);
  }

  function soumettre() {
    setMessage(null);
    startTransition(async () => {
      const res = await pointerPaiementsAction({
        date,
        mode,
        reference,
        affectations: lignes.map((l) => ({ ligneId: l.id, montantCts: parseEuros(montants[l.id] ?? "") })),
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${res.nb} ligne${res.nb > 1 ? "s" : ""} pointée${res.nb > 1 ? "s" : ""}.` });
        setTotal("");
        setMontants({});
        setReference("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.nbAppliquees > 0 ? `${res.nbAppliquees} ligne(s) enregistrée(s), puis erreur : ${res.error}` : res.error });
        if (res.nbAppliquees > 0) router.refresh();
      }
    });
  }

  const inputCls = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      {peutPointer && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:grid-cols-5">
          <div className="col-span-2 text-sm font-medium text-emerald-900 sm:col-span-5">
            {sens === "ENTREE" ? `Enregistrer un paiement reçu de ${cpNom}` : `Enregistrer un paiement versé à ${cpNom}`}
          </div>
          <label className="space-y-1 text-xs text-slate-600">
            Montant total (€)
            <input value={total} onChange={(e) => repartir(e.target.value)} inputMode="decimal" placeholder="Ex. 12 450,00" className={inputCls} />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            Date {sens === "ENTREE" ? "de réception" : "du paiement"}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
              <option value="VIREMENT">Virement</option>
              <option value="CHEQUE">Chèque</option>
              <option value="PRELEVEMENT">Prélèvement</option>
              <option value="CB">Carte</option>
              <option value="ESPECES">Espèces</option>
              <option value="AUTRE">Autre</option>
            </select>
          </label>
          <label className="col-span-2 space-y-1 text-xs text-slate-600">
            Référence (libellé bancaire, n° de virement...)
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
          </label>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Dossier</th>
              <th className="px-4 py-2.5">Nature</th>
              <th className="px-4 py-2.5">Échéance</th>
              <th className="px-4 py-2.5 text-right">Reste dû</th>
              {peutPointer && <th className="px-4 py-2.5 text-right">À affecter (€)</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <a href={`/dossiers/${l.dossierId}#flux-financiers`} className="font-medium text-slate-900 hover:text-emerald-700">
                    {l.clientLabel}
                  </a>
                  <div className="text-xs text-slate-400">{l.dossierReference}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {l.categorieLabel}
                  {l.virtuelle && <div className="text-xs text-amber-700">prévu d&apos;après le dossier</div>}
                  {l.factureId && <div className="text-xs text-slate-400">liée à une facture</div>}
                </td>
                <td className={`px-4 py-2 ${l.enRetard ? "font-medium text-red-600" : "text-slate-600"}`}>
                  {l.echeance ? new Date(l.echeance).toLocaleDateString("fr-FR") : <span className="text-slate-400">à dater</span>}
                  {l.echeance && l.echeanceEstimee && <span className="ml-1 text-xs text-slate-400">(estimée)</span>}
                  {l.enRetard && <span className="ml-1 text-xs">en retard</span>}
                </td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">{eur(l.resteCts)}</td>
                {peutPointer && (
                  <td className="px-4 py-2 text-right">
                    <input
                      value={montants[l.id] ?? ""}
                      onChange={(e) => setMontants((m) => ({ ...m, [l.id]: e.target.value }))}
                      inputMode="decimal"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {peutPointer && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={pending || affecteCts <= 0} onClick={soumettre}>
            Enregistrer {affecteCts > 0 ? eur(affecteCts) : ""}
          </Button>
          {totalCts > 0 && totalCts !== affecteCts && (
            <span className="text-xs text-amber-700">
              {totalCts > affecteCts ? `${eur(totalCts - affecteCts)} non affectés (plus que le reste dû).` : `Affecté ${eur(affecteCts - totalCts)} de plus que le montant saisi.`}
            </span>
          )}
          {message && <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</span>}
        </div>
      )}
    </div>
  );
}
