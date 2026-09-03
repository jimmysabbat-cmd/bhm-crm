import { prisma } from "@/lib/prisma";
import { createStatutCee, updateStatutCee, toggleStatutCee, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function StatutsCeePage() {
  const statuts = await prisma.statutCee.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Statuts du flux CEE, indépendants du statut général et du suivi ANAH (éligibilité, dépôt, contrôle, paiement...)."
      items={statuts.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouveau statut CEE..."
      reorderModel="statutCee"
      createAction={createStatutCee}
      updateAction={updateStatutCee}
      toggleAction={toggleStatutCee}
      deleteAction={deleteItem.bind(null, "statutCee")}
    />
  );
}
