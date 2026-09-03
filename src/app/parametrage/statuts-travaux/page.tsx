import { prisma } from "@/lib/prisma";
import { createStatutTravaux, updateStatutTravaux, toggleStatutTravaux, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function StatutsTravauxPage() {
  const statuts = await prisma.statutTravaux.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Statuts du flux travaux/chantier, indépendants du statut général du dossier (visite, planification, chantier, réserves, SAV...)."
      items={statuts.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouveau statut travaux..."
      reorderModel="statutTravaux"
      createAction={createStatutTravaux}
      updateAction={updateStatutTravaux}
      toggleAction={toggleStatutTravaux}
      deleteAction={deleteItem.bind(null, "statutTravaux")}
    />
  );
}
