import { UserPlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext } from "@/lib/authz";
import { createUser } from "../actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/field";
import { InviteUserForm } from "./InviteUserForm";
import { UserRoleSelect, UserRowActions } from "./UserRow";

export default async function EquipePage() {
  const ctx = await requireUserContext();
  const users = await prisma.user.findMany({
    where: { organisationId: ctx.organisationId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Chaque membre de l&apos;équipe se connecte avec son propre email et mot de passe. Un compte
        désactivé ne peut plus se connecter mais garde son historique (tâches assignées, etc.).
      </p>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Nom</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Rôle</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${!u.actif ? "opacity-40" : ""}`}>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {u.name[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium text-slate-900">{u.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{u.email}</td>
                <td className="px-5 py-3.5">
                  <UserRoleSelect userId={u.id} role={u.role} />
                </td>
                <td className="px-5 py-3.5 text-right">
                  <UserRowActions userId={u.id} actif={u.actif} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <form action={createUser} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-900">Ajouter un membre de l&apos;équipe</h2>
        <div className="grid grid-cols-2 gap-4">
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
            <select name="role" defaultValue="COMMERCIAL" className={inputClass}>
              <option value="COMMERCIAL">Commercial</option>
              <option value="COMPTA">Comptabilité</option>
              <option value="ADMIN">Administrateur</option>
            </select>
          </div>
        </div>
        <Button type="submit">
          <UserPlus className="h-4 w-4" />
          Créer le compte
        </Button>
      </form>

      <InviteUserForm />

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Export des données (P12)</h2>
        <p className="mt-1 text-xs text-slate-500">Export basique clients/leads/dossiers de votre organisation - aucun document inclus.</p>
        <div className="mt-3 flex gap-3">
          <a href="/api/export/tenant?format=json" className="text-xs font-medium text-emerald-700 hover:underline">
            Télécharger en JSON
          </a>
          <a href="/api/export/tenant?format=csv" className="text-xs font-medium text-emerald-700 hover:underline">
            Télécharger en CSV
          </a>
        </div>
      </Card>
    </div>
  );
}
