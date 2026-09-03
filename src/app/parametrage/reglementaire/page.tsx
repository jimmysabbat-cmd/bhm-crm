import { CheckCircle2, Circle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";
import { smallInputClass } from "@/components/ui/field";
import { publierVersionReglementaire, modifierBaremeReglementaire } from "../reglementaire-actions";

export default async function ReglementairePage() {
  const regles = await prisma.regleReglementaire.findMany({
    include: {
      versions: {
        orderBy: { dateDebutEffet: "desc" },
        include: { baremes: { orderBy: { cle: "asc" } }, _count: { select: { calculs: true } } },
      },
    },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Règles réglementaires versionnées (moteur P7) - globales à toutes les organisations, jamais dupliquées par
        client. Une version publiée et déjà utilisée par un calcul reste figée pour toujours : ses paramètres
        structurels ne peuvent plus être modifiés.
      </p>

      {regles.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-slate-400">Aucune règle réglementaire enregistrée.</p>
        </Card>
      )}

      {regles.map((regle) => (
        <Card key={regle.id} className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-900">{regle.code}</p>
              <Badge color="slate">{regle.secteur}</Badge>
              <Badge color="slate">{regle.famille}</Badge>
              {!regle.actif && <Badge color="red">Inactif</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{regle.nom}</p>
            {regle.description && <p className="mt-1 text-xs text-slate-400">{regle.description}</p>}
          </div>

          <div className="divide-y divide-slate-100">
            {regle.versions.map((version) => (
              <details key={version.id} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  {version.publie ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      Version {version.numeroVersion}
                      {version.publie ? (
                        <span className="ml-2 text-xs font-normal text-emerald-700">Publiée</span>
                      ) : (
                        <span className="ml-2 text-xs font-normal text-slate-400">Brouillon</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      Applicable du {version.dateDebutEffet.toLocaleDateString("fr-FR")} au{" "}
                      {version.dateFinEffet ? version.dateFinEffet.toLocaleDateString("fr-FR") : "aujourd'hui"} — formule{" "}
                      {version.formulaCode}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{version._count.calculs} calcul(s)</span>
                </summary>

                <div className="mt-3 space-y-3 pl-7 text-sm">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
                    <div>
                      <dt className="text-slate-400">Source</dt>
                      <dd className="text-slate-700">{version.sourceNom}</dd>
                    </div>
                    {version.sourceReference && (
                      <div>
                        <dt className="text-slate-400">Référence</dt>
                        <dd className="text-slate-700">{version.sourceReference}</dd>
                      </div>
                    )}
                    {version.sourceDatePublication && (
                      <div>
                        <dt className="text-slate-400">Date de publication source</dt>
                        <dd className="text-slate-700">{version.sourceDatePublication.toLocaleDateString("fr-FR")}</dd>
                      </div>
                    )}
                  </dl>
                  {version.commentaire && <p className="text-xs italic text-amber-700">{version.commentaire}</p>}

                  {!version.publie && (
                    <form action={publierVersionReglementaire.bind(null, version.id)}>
                      <ConfirmSubmitButton
                        label="Publier cette version"
                        confirmMessage="Publier cette version ? Une fois publiée et utilisée par un calcul, elle ne pourra plus être modifiée."
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      />
                    </form>
                  )}

                  <div className="overflow-hidden rounded-lg border border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Clé</th>
                          <th className="px-3 py-2 text-right">Valeur</th>
                          {!version.publie && <th className="px-3 py-2"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {version.baremes.map((bareme) => (
                          <tr key={bareme.id} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-mono text-slate-600">{bareme.cle}</td>
                            {version.publie ? (
                              <td className="px-3 py-1.5 text-right text-slate-800">{bareme.valeur.toLocaleString("fr-FR")}</td>
                            ) : (
                              <td colSpan={2} className="px-3 py-1.5">
                                <form
                                  action={modifierBaremeReglementaire.bind(null, bareme.id)}
                                  className="flex items-center justify-end gap-2"
                                >
                                  <input
                                    name="valeur"
                                    type="number"
                                    defaultValue={bareme.valeur}
                                    className={`w-28 text-right ${smallInputClass}`}
                                  />
                                  <Button type="submit" variant="ghost" className="text-xs">
                                    Enregistrer
                                  </Button>
                                </form>
                              </td>
                            )}
                          </tr>
                        ))}
                        {version.baremes.length === 0 && (
                          <tr>
                            <td colSpan={2} className="px-3 py-3 text-center text-slate-400">
                              Aucune valeur de barème.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
            {regle.versions.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">Aucune version.</p>}
          </div>
        </Card>
      ))}
    </div>
  );
}
