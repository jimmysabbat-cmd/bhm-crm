import { prisma } from "@/lib/prisma";
import { createRegie, updateRegie, toggleRegie } from "../actions";
import { ParamList } from "../ParamList";

export default async function RegiePage() {
  const equipes = await prisma.regie.findMany({ orderBy: { ordre: "asc" } });

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
    />
  );
}
