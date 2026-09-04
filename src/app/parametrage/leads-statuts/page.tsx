import { prisma } from "@/lib/prisma";
import { createLeadPipelineStatus, updateLeadPipelineStatus, toggleLeadPipelineStatus, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function LeadPipelineStatusesPage() {
  const statuts = await prisma.leadPipelineStatus.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Statuts du pipeline commercial (distinct du workflow administratif ANAH/CEE/travaux). L'ordre ici détermine aussi l'ordre du funnel de conversion."
      items={statuts.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouveau statut pipeline..."
      reorderModel="leadPipelineStatus"
      createAction={createLeadPipelineStatus}
      updateAction={updateLeadPipelineStatus}
      toggleAction={toggleLeadPipelineStatus}
      deleteAction={deleteItem.bind(null, "leadPipelineStatus")}
    />
  );
}
