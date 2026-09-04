import Link from "next/link";
import { requirePlatformContext } from "@/lib/authz";
import { getPlatformOrganisations } from "@/lib/platform/organisations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// ============================================================
// Accueil plateforme (P12, section 16) - inaccessible à un tenant, même
// ADMIN. requirePlatformContext() lève une erreur pour quiconque n'est pas
// isPlatformSuperAdmin (jamais Role.ADMIN).
// ============================================================

export default async function PlatformPage() {
  await requirePlatformContext();
  const orgs = await getPlatformOrganisations();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Plateforme</h1>
        <p className="mt-1 text-sm text-slate-500">{orgs.length} organisation(s) au total.</p>
      </div>
      <Card className="p-5">
        <p className="text-sm text-slate-600">
          Vous êtes connecté en tant que <strong>Platform Super Admin</strong>. Ce niveau administre la plateforme SaaS
          elle-même - pour travailler sur les données d&apos;un tenant (BHM, RUA...), entrez dans son organisation.
        </p>
        <Link href="/platform/organisations" className="mt-4 inline-block rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
          Gérer les organisations →
        </Link>
      </Card>
      <div className="grid grid-cols-3 gap-4">
        {orgs.slice(0, 6).map((o) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{o.nom}</p>
              <Badge color={o.status === "ACTIVE" ? "emerald" : o.status === "SUSPENDED" ? "amber" : "slate"}>{o.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">{o._count.users} utilisateur(s) · {o._count.dossiers} dossier(s)</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
