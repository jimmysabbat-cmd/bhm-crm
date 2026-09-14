import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/authz";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { Card } from "@/components/ui/Card";
import { NouvelleDemandeForm } from "./NouvelleDemandeForm";

export default async function NouvelleDemandePage() {
  const ctx = await requireUserContext();
  if (ctx.role !== "DONNEUR_ORDRE") redirect("/");

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Envoyer un chantier</h1>
        <p className="mt-1 text-sm text-slate-500">Renseignez les informations ci-dessous, l&apos;équipe BHM/RUA reçoit et qualifie votre demande.</p>
      </div>
      <Card className="p-6">
        <NouvelleDemandeForm typeTravauxOptions={Object.entries(typeTravauxLabels)} />
      </Card>
    </div>
  );
}
