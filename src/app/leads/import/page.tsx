import { redirect } from "next/navigation";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { ImportLeadsWizard } from "../ImportLeadsWizard";

export default async function ImportLeadsPage() {
  const ctx = await requireUserContext();
  if (!hasPermission(ctx, "IMPORT_LEADS")) redirect("/leads");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Import de leads (CSV)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Colonnes reconnues : nom, prénom, téléphone, email, adresse, CP, ville, source, commentaire.
        </p>
      </div>
      <ImportLeadsWizard />
    </div>
  );
}
