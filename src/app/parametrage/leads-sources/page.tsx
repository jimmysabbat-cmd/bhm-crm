import { prisma } from "@/lib/prisma";
import { createLeadSource, updateLeadSource, toggleLeadSource, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function LeadSourcesPage() {
  const sources = await prisma.leadSource.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Sources de leads (téléprospection, fournisseur, site web...). Utilisées pour créer un lead et filtrer /leads."
      items={sources.map((s) => ({ id: s.id, value: s.label, actif: s.actif }))}
      fieldName="label"
      placeholder="Nouvelle source..."
      reorderModel="leadSource"
      createAction={createLeadSource}
      updateAction={updateLeadSource}
      toggleAction={toggleLeadSource}
      deleteAction={deleteItem.bind(null, "leadSource")}
    />
  );
}
