import { prisma } from "@/lib/prisma";
import { createUser, toggleUserActif } from "../actions";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const labelClass = "text-sm font-medium text-neutral-700";

const roleLabels: Record<string, string> = {
  ADMIN: "Administrateur",
  COMMERCIAL: "Commercial",
  COMPTA: "Comptabilité",
};

export default async function EquipePage() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Chaque membre de l&apos;équipe se connecte avec son propre email et mot de passe. Un compte
        désactivé ne peut plus se connecter mais garde son historique (tâches assignées, etc.).
      </p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rôle</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-neutral-100 ${!u.actif ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-medium text-neutral-900">{u.name}</td>
                <td className="px-4 py-3 text-neutral-600">{u.email}</td>
                <td className="px-4 py-3 text-neutral-600">{roleLabels[u.role] ?? u.role}</td>
                <td className="px-4 py-3 text-right">
                  <form action={async () => { "use server"; await toggleUserActif(u.id, !u.actif); }}>
                    <button type="submit" className="text-xs text-neutral-500 hover:text-neutral-900">
                      {u.actif ? "Désactiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={createUser} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-900">Ajouter un membre de l&apos;équipe</h2>
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
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Créer le compte
        </button>
      </form>
    </div>
  );
}
