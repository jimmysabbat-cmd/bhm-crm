import { formatCents } from "@/lib/money";

export type PosteTechniqueData = {
  surfaceM2: number | null;
  quantite: number | null;
  materiau: string | null;
  marqueReference: string | null;
  epaisseurMm: number | null;
  resistanceThermique: number | null;
  materielFourniPar: string | null;
  prixPoseProposeHTCts: number | null;
  notesTechniques: string | null;
};

export function hasPosteTechnique(p: PosteTechniqueData): boolean {
  return Boolean(p.materiau || p.marqueReference || p.epaisseurMm || p.resistanceThermique || p.materielFourniPar || p.prixPoseProposeHTCts || p.notesTechniques);
}

// Détail technique d'une pose (matériau, épaisseur, R...) - affiché à
// l'identique côté portail donneur d'ordre et côté fiche dossier interne.
export function PosteTechnique({ p, showPrix = true }: { p: PosteTechniqueData; showPrix?: boolean }) {
  const items: [string, string][] = [];
  if (p.surfaceM2) items.push(["Surface", `${p.surfaceM2.toLocaleString("fr-FR")} m²`]);
  if (p.quantite) items.push(["Quantité", String(p.quantite)]);
  if (p.materiau) items.push(["Matériau", p.materiau]);
  if (p.marqueReference) items.push(["Marque / réf.", p.marqueReference]);
  if (p.epaisseurMm) items.push(["Épaisseur", `${p.epaisseurMm.toLocaleString("fr-FR")} mm`]);
  if (p.resistanceThermique) items.push(["R", `${p.resistanceThermique.toLocaleString("fr-FR")} m².K/W`]);
  if (p.materielFourniPar) items.push(["Matériel fourni par", p.materielFourniPar === "DONNEUR_ORDRE" ? "le donneur d'ordre" : "l'entreprise de pose"]);
  if (showPrix && p.prixPoseProposeHTCts) items.push(["Prix de pose proposé", `${formatCents(p.prixPoseProposeHTCts)} HT`]);
  if (items.length === 0 && !p.notesTechniques) return null;
  return (
    <div className="mt-1 space-y-1">
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="inline">{k} : </dt>
            <dd className="inline font-medium text-slate-700">{v}</dd>
          </div>
        ))}
      </dl>
      {p.notesTechniques && <p className="whitespace-pre-line text-xs text-slate-500">{p.notesTechniques}</p>}
    </div>
  );
}
