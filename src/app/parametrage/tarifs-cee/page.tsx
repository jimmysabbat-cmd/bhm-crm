import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";
import { createTarifDelegataireCee, updateTarifDelegataireCee, toggleTarifDelegataireCee } from "../tarifs-cee-actions";

function centsToEurosStr(cts: number): string {
  return (cts / 100).toString();
}

export default async function TarifsCeePage() {
  const ctx = await requireUserContext();
  const [tarifs, delegataires] = await Promise.all([
    prisma.tarifDelegataireCee.findMany({
      where: { organisationId: ctx.organisationId },
      include: { delegataire: true },
      orderBy: [{ delegataireId: "asc" }, { dateDebut: "desc" }],
    }),
    prisma.delegataireCee.findMany({ where: { actif: true, organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Tarifs commerciaux CEE négociés avec chaque délégataire - propres à votre organisation, distincts des règles
        réglementaires (kWh cumac ≠ valeur €). Un tarif sans fiche renseignée s&apos;applique par défaut à toutes les
        fiches CEE de ce délégataire.
      </p>

      <Card className="overflow-hidden">
        {tarifs.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun tarif configuré.</p>}
        {tarifs.map((t) => (
          <form
            key={t.id}
            action={updateTarifDelegataireCee.bind(null, t.id)}
            className={`space-y-2 border-b border-slate-100 px-5 py-4 last:border-0 ${!t.actif ? "opacity-40" : ""}`}
          >
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-900">{t.delegataire.nom}</p>
              <Badge color="slate">{t.categorie}</Badge>
              {t.ficheCode && <Badge color="blue">{t.ficheCode}</Badge>}
              {!t.actif && <Badge color="red">Inactif</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <input name="ficheCode" placeholder="Fiche (vide = toutes)" defaultValue={t.ficheCode ?? ""} className={smallInputClass} />
              <select name="categorie" defaultValue={t.categorie} className={smallInputClass}>
                <option value="TRES_MODESTE">Très modeste</option>
                <option value="CLASSIQUE">Modeste / Classique</option>
              </select>
              <input
                name="tauxEurosParMwhc"
                type="number"
                step="0.01"
                placeholder="Taux €/MWhc"
                defaultValue={centsToEurosStr(t.tauxCtsParMwhc)}
                className={smallInputClass}
              />
              <input name="dateDebut" type="date" defaultValue={t.dateDebut.toISOString().slice(0, 10)} className={smallInputClass} />
              <input
                name="dateFin"
                type="date"
                defaultValue={t.dateFin ? t.dateFin.toISOString().slice(0, 10) : ""}
                className={smallInputClass}
              />
              <input
                name="delaiPaiementJours"
                type="number"
                placeholder="Délai paiement (j)"
                defaultValue={t.delaiPaiementJours ?? ""}
                className={smallInputClass}
              />
            </div>
            <input name="commentaire" placeholder="Commentaire" defaultValue={t.commentaire ?? ""} className={smallInputClass} />
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" variant="secondary" className="text-xs">
                Enregistrer
              </Button>
              <Button
                type="submit"
                variant="ghost"
                className="text-xs"
                formAction={async () => {
                  "use server";
                  await toggleTarifDelegataireCee(t.id, !t.actif);
                }}
              >
                {t.actif ? "Désactiver" : "Activer"}
              </Button>
              <span className="ml-auto text-xs text-slate-400">
                Prime pour 100 MWhc : {formatCents(Math.round(100 * t.tauxCtsParMwhc))}
              </span>
            </div>
          </form>
        ))}
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-medium text-slate-700">Ajouter un tarif</p>
        <form action={createTarifDelegataireCee} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="space-y-1">
            <label className={labelClass}>Délégataire</label>
            <select name="delegataireId" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Choisir…
              </option>
              {delegataires.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Fiche (vide = toutes)</label>
            <input name="ficheCode" placeholder="ex. BAR-TH-171" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Catégorie</label>
            <select name="categorie" className={inputClass} defaultValue="CLASSIQUE">
              <option value="TRES_MODESTE">Très modeste</option>
              <option value="CLASSIQUE">Modeste / Classique</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Taux (€/MWhc)</label>
            <input name="tauxEurosParMwhc" type="number" step="0.01" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Date de début</label>
            <input name="dateDebut" type="date" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Délai paiement (jours)</label>
            <input name="delaiPaiementJours" type="number" className={inputClass} />
          </div>
          <div className="col-span-2 sm:col-span-6">
            <Button type="submit" className="text-xs">
              Ajouter le tarif
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
