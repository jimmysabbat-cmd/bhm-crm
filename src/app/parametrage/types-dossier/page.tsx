import { prisma } from "@/lib/prisma";
import { createDossierType, updateDossierType, toggleDossierType, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function TypesDossierPage() {
  const types = await prisma.dossierType.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Types de dossier proposés à la création (rénovation d'ampleur ANAH, CEE seul, monogeste...)."
      items={types.map((t) => ({ id: t.id, value: t.label, actif: t.actif }))}
      fieldName="label"
      placeholder="Nouveau type de dossier..."
      reorderModel="dossierType"
      createAction={createDossierType}
      updateAction={updateDossierType}
      toggleAction={toggleDossierType}
      deleteAction={deleteItem.bind(null, "dossierType")}
    />
  );
}
