import { prisma } from "@/lib/prisma";
import { createMar, updateMar, toggleMar, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function MarPage() {
  const mars = await prisma.mar.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Accompagnateurs Rénov (MAR) proposés sur les dossiers de rénovation d'ampleur."
      items={mars.map((m) => ({ id: m.id, value: m.nom, actif: m.actif }))}
      fieldName="nom"
      placeholder="Nouveau MAR..."
      reorderModel="mar"
      createAction={createMar}
      updateAction={updateMar}
      toggleAction={toggleMar}
      deleteAction={deleteItem.bind(null, "mar")}
    />
  );
}
