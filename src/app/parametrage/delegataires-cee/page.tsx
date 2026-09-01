import { prisma } from "@/lib/prisma";
import { createDelegataireCee, updateDelegataireCee, toggleDelegataireCee, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function DelegatairesCeePage() {
  const delegataires = await prisma.delegataireCee.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Délégataires CEE proposés sur les dossiers percevant une prime CEE."
      items={delegataires.map((d) => ({ id: d.id, value: d.nom, actif: d.actif }))}
      fieldName="nom"
      placeholder="Nouveau délégataire CEE..."
      reorderModel="delegataireCee"
      createAction={createDelegataireCee}
      updateAction={updateDelegataireCee}
      toggleAction={toggleDelegataireCee}
      deleteAction={deleteItem.bind(null, "delegataireCee")}
    />
  );
}
