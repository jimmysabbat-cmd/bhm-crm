import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createRegie, updateRegie, toggleRegie, deleteItem } from "../actions";
import { ParamList } from "../ParamList";

export default async function RegiePage() {
  const ctx = await requireUserContext();
  const equipes = await prisma.regie.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Équipes internes (régie) proposées pour la pose d'un poste de travaux, en alternative à un sous-traitant."
      items={equipes.map((r) => ({ id: r.id, value: r.nom, actif: r.actif }))}
      fieldName="nom"
      placeholder="Nouvelle équipe régie..."
      reorderModel="regie"
      createAction={createRegie}
      updateAction={updateRegie}
      toggleAction={toggleRegie}
      deleteAction={deleteItem.bind(null, "regie")}
    />
  );
}
