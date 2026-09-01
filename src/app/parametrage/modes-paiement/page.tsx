import { prisma } from "@/lib/prisma";
import { createModePaiement, updateModePaiement, toggleModePaiement } from "../actions";
import { ParamList } from "../ParamList";

export default async function ModesPaiementPage() {
  const modes = await prisma.modePaiement.findMany({ orderBy: { ordre: "asc" } });

  return (
    <ParamList
      description="Modes de perception de l'aide proposés sur un dossier (client avance, avance 30% ANAH, mandataire...)."
      items={modes.map((m) => ({ id: m.id, value: m.label, actif: m.actif }))}
      fieldName="label"
      placeholder="Nouveau mode de paiement..."
      reorderModel="modePaiement"
      createAction={createModePaiement}
      updateAction={updateModePaiement}
      toggleAction={toggleModePaiement}
    />
  );
}
