import { prisma } from "@/lib/prisma";
import { createStatutAnah, updateStatutAnah, toggleStatutAnah, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function StatutsAnahPage() {
  const statuts = await prisma.statutAnah.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Statuts du suivi administratif ANAH, affichés uniquement sur les dossiers de rénovation d'ampleur (dépôt, instruction, avance, solde...)."
      items={statuts.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouveau statut ANAH..."
      reorderModel="statutAnah"
      createAction={createStatutAnah}
      updateAction={updateStatutAnah}
      toggleAction={toggleStatutAnah}
      deleteAction={deleteItem.bind(null, "statutAnah")}
    />
  );
}
