import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/authz";
import { getDemandesForDonneurOrdre } from "@/lib/donneurs-ordre/access";
import { DemandesList } from "../DemandesList";

export default async function ADemanderPage() {
  const ctx = await requireUserContext();
  if (ctx.role !== "DONNEUR_ORDRE") redirect("/");
  const demandes = await getDemandesForDonneurOrdre(ctx, "a-programmer");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">À programmer</h1>
      <DemandesList title="Qualifiées, en attente de programmation" demandes={demandes} />
    </div>
  );
}
