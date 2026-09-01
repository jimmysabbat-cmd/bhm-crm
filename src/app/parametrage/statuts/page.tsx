import { prisma } from "@/lib/prisma";
import { createDossierStatus, updateDossierStatus, toggleDossierStatus, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function StatutsPage() {
  const statuts = await prisma.dossierStatus.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Ces statuts apparaissent dans le menu déroulant de chaque dossier. Renomme-les, ajoutes-en, ou archive ceux que tu n'utilises plus (ils restent visibles sur les dossiers déjà existants)."
      items={statuts.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouveau statut..."
      reorderModel="dossierStatus"
      createAction={createDossierStatus}
      updateAction={updateDossierStatus}
      toggleAction={toggleDossierStatus}
      deleteAction={deleteItem.bind(null, "dossierStatus")}
    />
  );
}
