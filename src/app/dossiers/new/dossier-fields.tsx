"use client";

import { useState } from "react";
import { Plus, Trash2, Calculator } from "lucide-react";
import type { TypeTravaux, Precarite } from "@/generated/prisma/enums";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { baremeLabel, gesteMontantCts } from "@/lib/mpr-geste-baremes";
import { formatCents } from "@/lib/money";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";
import { MprAmpleurCalculator } from "@/components/ui/MprAmpleurCalculator";

type TypeOption = { id: string; key: string; label: string };
type MarOption = { id: string; nom: string };
type StatutAnahOption = { id: string; label: string };
type DelegataireOption = { id: string; nom: string };

const typeOptions = (Object.keys(typeTravauxLabels) as TypeTravaux[]).filter((t) => t !== "AUTRE");

const SURFACIQUES = new Set<TypeTravaux>(["ITE", "ITI", "COMBLES", "RAMPANTS", "TOITURE_TERRASSE"]);
const VOLUMIQUES = new Set<TypeTravaux>([
  "CHAUFFE_EAU_THERMODYNAMIQUE",
  "BALLON_THERMODYNAMIQUE",
  "CHAUFFE_EAU_SOLAIRE_INDIVIDUEL",
  "CHAUFFAGE_SOLAIRE_COMBINE",
]);

// Unité pertinente pour la 2e colonne, selon le geste choisi.
function uniteDetail(type: TypeTravaux | ""): { name: "surfaceM2" | "quantite"; label: string } | null {
  if (SURFACIQUES.has(type as TypeTravaux)) return { name: "surfaceM2", label: "Surface (m²)" };
  if (VOLUMIQUES.has(type as TypeTravaux)) return { name: "quantite", label: "Volume (L)" };
  if (type === "PAC_AIR_AIR") return { name: "quantite", label: "Nombre de splits" };
  if (type === "PAROIS_VITREES") return { name: "quantite", label: "Nombre de fenêtres" };
  if (type === "") return null;
  return { name: "quantite", label: "Quantité (si plusieurs)" };
}

const TVA_RENOVATION = 1.055; // TVA à 5,5% pour ces travaux — HT dérivé automatiquement du TTC

let nextId = 1;

type Ligne = {
  id: number;
  type: TypeTravaux | "";
  detail: string;
  montantTTC: string;
  montantHT: string;
  htTouche: boolean;
};

function nouvelleLigne(): Ligne {
  return { id: nextId++, type: "", detail: "", montantTTC: "", montantHT: "", htTouche: false };
}

export function DossierFields({
  types,
  mars,
  statutsAnah,
  delegatairesCee,
}: {
  types: TypeOption[];
  mars: MarOption[];
  statutsAnah: StatutAnahOption[];
  delegatairesCee: DelegataireOption[];
}) {
  const [typeId, setTypeId] = useState("");
  const selected = types.find((t) => t.id === typeId);
  const isRenoAmpleur = selected?.key.startsWith("RENOVATION_AMPLEUR") ?? false;
  const noCee = selected?.key === "RENOVATION_AMPLEUR_ANAH";

  const [lignes, setLignes] = useState<Ligne[]>([nouvelleLigne()]);
  const [dateDepotMono, setDateDepotMono] = useState("");
  const [precariteMono, setPrecariteMono] = useState<Precarite>("TRES_MODESTE");

  function updateLigne(id: number, patch: Partial<Ligne>) {
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function onTTCChange(id: number, value: string) {
    setLignes((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, montantTTC: value };
        if (!l.htTouche) {
          const ttc = Number(value) || 0;
          next.montantHT = value === "" ? "" : (ttc / TVA_RENOVATION).toFixed(2);
        }
        return next;
      })
    );
  }

  const sommeHTCts = lignes.reduce((s, l) => s + Math.round((Number(l.montantHT) || 0) * 100), 0);
  const sommeTTCCts = lignes.reduce((s, l) => s + Math.round((Number(l.montantTTC) || 0) * 100), 0);

  const [devisTTCManual, setDevisTTCManual] = useState("");
  const [touchedDevis, setTouchedDevis] = useState(false);
  const devisTTC = touchedDevis ? devisTTCManual : sommeTTCCts ? (sommeTTCCts / 100).toFixed(2) : "";

  const totalMonogesteCts = lignes.reduce((s, l) => {
    if (!l.type) return s;
    const detail = uniteDetail(l.type);
    const qty = detail ? Number(l.detail) || 0 : 1;
    const m = gesteMontantCts(dateDepotMono, l.type as TypeTravaux, precariteMono, qty);
    return s + (m ?? 0);
  }, 0);

  function appliquerMonogeste() {
    const el = document.getElementById("montantAideMPR") as HTMLInputElement | null;
    if (!el) return;
    el.value = (totalMonogesteCts / 100).toFixed(2);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <>
      <div className="space-y-1">
        <label className={labelClass}>Type de dossier</label>
        <select
          name="typeId"
          required
          className={inputClass}
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          <option value="" disabled>
            Choisir...
          </option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className={labelClass}>Date de signature</label>
        <input name="dateSignatureDevis" type="date" className={inputClass} />
      </div>

      {isRenoAmpleur && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>MAR (accompagnateur Rénov)</label>
            <select name="marId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {mars.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date de dépôt ANAH</label>
            <input name="dateDepotAnah" type="date" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date d&apos;octroi ANAH</label>
            <input name="dateOctroiAnah" type="date" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Statut ANAH</label>
            <select name="statutAnahId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {statutsAnah.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {typeId && (
        <div className="col-span-2 space-y-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm shadow-slate-200/50">
          <p className="text-sm font-semibold text-slate-900">Travaux prévus</p>
          <div className="space-y-3">
            {lignes.map((ligne) => {
              const detail = uniteDetail(ligne.type);
              const forfait =
                !isRenoAmpleur && ligne.type
                  ? gesteMontantCts(
                      dateDepotMono,
                      ligne.type as TypeTravaux,
                      precariteMono,
                      detail ? Number(ligne.detail) || 0 : 1
                    )
                  : null;
              return (
                <div
                  key={ligne.id}
                  className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-5"
                >
                  <div className="space-y-1">
                    <label className={labelClass}>Type de travaux</label>
                    <select
                      name={`travaux.${ligne.id}.type`}
                      value={ligne.type}
                      onChange={(e) => updateLigne(ligne.id, { type: e.target.value as TypeTravaux, detail: "" })}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {typeOptions.map((t) => (
                        <option key={t} value={t}>
                          {typeTravauxLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {detail && (
                    <div className="space-y-1">
                      <label className={labelClass}>{detail.label}</label>
                      <input
                        name={`travaux.${ligne.id}.${detail.name}`}
                        type="number"
                        step="0.01"
                        value={ligne.detail}
                        onChange={(e) => updateLigne(ligne.id, { detail: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className={labelClass}>Montant TTC (€)</label>
                    <input
                      name={`travaux.${ligne.id}.montantTTC`}
                      type="number"
                      step="0.01"
                      value={ligne.montantTTC}
                      onChange={(e) => onTTCChange(ligne.id, e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Montant HT (€, TVA 5,5%)</label>
                    <input
                      name={`travaux.${ligne.id}.montantHT`}
                      type="number"
                      step="0.01"
                      value={ligne.montantHT}
                      onChange={(e) => updateLigne(ligne.id, { montantHT: e.target.value, htTouche: true })}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    {forfait !== null && (
                      <span className="text-xs font-medium text-emerald-700">
                        MPR {formatCents(forfait)}
                      </span>
                    )}
                    {lignes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLignes((ls) => ls.filter((l) => l.id !== ligne.id))}
                        className="ml-auto text-slate-400 hover:text-red-600"
                        aria-label="Retirer ce geste"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={() => setLignes((ls) => [...ls, nouvelleLigne()])}
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un geste
          </Button>
        </div>
      )}

      {typeId && (
        <div className="space-y-1">
          <label className={labelClass}>
            Devis TTC (€)
            {!touchedDevis && sommeTTCCts > 0 && (
              <span className="ml-1 normal-case text-emerald-600">(auto, depuis les postes)</span>
            )}
          </label>
          <input
            name="montantDevisTTC"
            type="number"
            step="0.01"
            required
            value={devisTTC}
            onChange={(e) => {
              setTouchedDevis(true);
              setDevisTTCManual(e.target.value);
            }}
            className={inputClass}
          />
        </div>
      )}

      {isRenoAmpleur && (
        <div className="col-span-2">
          <MprAmpleurCalculator
            targetInputId="montantAideMPR"
            defaultOpen
            prefilMontantHTCts={sommeHTCts}
          />
        </div>
      )}

      {typeId && !isRenoAmpleur && (
        <div className="col-span-2 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <Calculator className="h-3.5 w-3.5" />
            Aide MPR monogeste — calculée à partir des travaux ci-dessus
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={labelClass}>Date de dépôt du dossier</label>
              <input
                type="date"
                value={dateDepotMono}
                onChange={(e) => setDateDepotMono(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Catégorie de revenu</label>
              <select
                value={precariteMono}
                onChange={(e) => setPrecariteMono(e.target.value as Precarite)}
                className={inputClass}
              >
                <option value="TRES_MODESTE">Très modeste</option>
                <option value="MODESTE">Modeste</option>
                <option value="INTERMEDIAIRE">Intermédiaire</option>
                <option value="SUPERIEUR">Supérieur</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">Barème appliqué : {baremeLabel(dateDepotMono)}</p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
            <span className="text-slate-500">Total aide MPR estimée</span>
            <span className="text-lg font-semibold text-emerald-700">{formatCents(totalMonogesteCts)}</span>
          </div>
          <Button type="button" variant="secondary" className="text-xs" onClick={appliquerMonogeste}>
            Utiliser ce montant
          </Button>
        </div>
      )}

      {typeId && !noCee && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Aide CEE (€)</label>
            <input name="montantAideCEE" type="number" step="0.01" defaultValue={0} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Délégataire CEE</label>
            <select name="delegataireCeeId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {delegatairesCee.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
