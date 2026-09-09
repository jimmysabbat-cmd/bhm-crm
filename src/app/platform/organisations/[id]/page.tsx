import Link from "next/link";
import { requirePlatformContext } from "@/lib/authz";
import { getOrganisationAccessDetails } from "@/lib/platform/tenant-users";
import { roleLabels } from "@/lib/next-best-action";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, labelClass } from "@/components/ui/field";
import { platformCreateUserAction, platformInviteUserAction } from "../../tenant-users-actions";
import { TenantUserRow, RegenerateInvitationButton } from "./TenantUserRow";

// ============================================================
// /platform/organisations/[id] (P13, audit SaaS section A) - fiche
// détaillée d'un tenant : société, admin principal, utilisateurs,
// invitations en attente. Réservé PLATFORM SUPER ADMIN
// (requirePlatformContext(), jamais Role.ADMIN).
// ============================================================

export default async function PlatformOrganisationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformContext();
  const { id } = await params;
  const details = await getOrganisationAccessDetails(id);
  const { organisation, principalAdmin, users, pendingInvitations } = details;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <p className="text-xs text-slate-400">
          <Link href="/platform/organisations" className="hover:underline">
            Organisations
          </Link>
          {" / "}
          {organisation.nom}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{organisation.nom}</h1>
          <Badge color={organisation.status === "ACTIVE" ? "emerald" : organisation.status === "SUSPENDED" ? "amber" : "slate"}>{organisation.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {organisation.slug} · créée le {new Date(organisation.createdAt).toLocaleDateString("fr-FR")}
          {organisation.email ? ` · ${organisation.email} (email société)` : ""}
        </p>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Admin principal</h2>
        {principalAdmin ? (
          <div className="text-sm text-slate-700">
            <p className="font-medium">{principalAdmin.name}</p>
            <p className="text-xs text-slate-500">{principalAdmin.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              {roleLabels[principalAdmin.role] ?? principalAdmin.role} · {principalAdmin.actif ? "Actif" : "Suspendu"} · dernière connexion{" "}
              {principalAdmin.lastLoginAt ? new Date(principalAdmin.lastLoginAt).toLocaleString("fr-FR") : "jamais"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Aucun admin principal désigné. Créez un compte ADMIN ci-dessous puis cliquez &laquo;&nbsp;Définir admin principal&nbsp;&raquo; sur sa ligne.</p>
        )}
      </Card>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        <div className="px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Utilisateurs ({users.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Nom</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Créé le</th>
              <th className="px-5 py-3">Dernière connexion</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${!u.actif ? "opacity-40" : ""}`}>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{u.name}</span>
                    {u.isPrincipalAdmin && <Badge color="emerald">Admin principal</Badge>}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{u.email}</td>
                <td className="px-5 py-3.5 text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString("fr-FR")}</td>
                <td className="px-5 py-3.5 text-xs text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "jamais"}</td>
                <td className="px-5 py-3.5 text-xs">{u.actif ? <Badge color="emerald">Actif</Badge> : <Badge color="slate">Suspendu</Badge>}</td>
                <td className="px-5 py-3.5 text-right">
                  <TenantUserRow organisationId={organisation.id} userId={u.id} role={u.role} actif={u.actif} isPrincipalAdmin={u.isPrincipalAdmin} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucun utilisateur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {pendingInvitations.length > 0 && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          <div className="px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Invitations en attente ({pendingInvitations.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Rôle</th>
                <th className="px-5 py-3">Expire le</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvitations.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-5 py-3.5 text-slate-700">{inv.email}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{roleLabels[inv.role] ?? inv.role}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-400">{new Date(inv.expiresAt).toLocaleString("fr-FR")}</td>
                  <td className="px-5 py-3.5 text-xs">{inv.expired ? <Badge color="amber">Expirée</Badge> : <Badge color="slate">En attente</Badge>}</td>
                  <td className="px-5 py-3.5 text-right">
                    <RegenerateInvitationButton organisationId={organisation.id} invitationId={inv.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Créer un accès direct (méthode A)</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            await platformCreateUserAction(organisation.id, formData);
          }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="name" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Mot de passe provisoire</label>
            <input name="password" type="password" required minLength={8} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Rôle</label>
            <select name="role" defaultValue="ADMIN" className={inputClass}>
              <option value="ADMIN">Administrateur</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="COMPTABILITE">Comptabilité</option>
            </select>
          </div>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
              Créer le compte
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Inviter (méthode B)</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            await platformInviteUserAction(organisation.id, formData);
          }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Rôle</label>
            <select name="role" defaultValue="ADMIN" className={inputClass}>
              <option value="ADMIN">Administrateur</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="COMPTABILITE">Comptabilité</option>
            </select>
          </div>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">
              Générer le lien d&apos;invitation
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
