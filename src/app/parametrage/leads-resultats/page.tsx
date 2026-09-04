import { prisma } from "@/lib/prisma";
import { createResultatAppel, updateResultatAppel, toggleResultatAppel, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function ResultatsAppelPage() {
  const resultats = await prisma.resultatAppel.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Résultats d'appel proposés dans le workspace de qualification. La proposition automatique de statut/délai de rappel associée à chaque résultat reste définie au niveau des données (non éditable ici en V1)."
      items={resultats.map((r) => ({ id: r.id, value: r.label, actif: r.actif }))}
      fieldName="label"
      placeholder="Nouveau résultat..."
      reorderModel="resultatAppel"
      createAction={createResultatAppel}
      updateAction={updateResultatAppel}
      toggleAction={toggleResultatAppel}
      deleteAction={deleteItem.bind(null, "resultatAppel")}
    />
  );
}
