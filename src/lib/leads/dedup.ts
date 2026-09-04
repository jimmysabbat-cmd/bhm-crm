import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone";

// ============================================================
// Détection de doublons potentiels (P9, section 15). Volontairement
// PRUDENTE : ne bloque jamais une création, se contente de signaler un
// "doublon potentiel" avec la raison précise (téléphone/email) pour que
// l'humain décide - jamais un blocage automatique sur une simple
// ressemblance (adresse notamment, trop peu fiable seule).
// ============================================================

export type PotentialDuplicate = {
  type: "LEAD" | "CLIENT";
  id: string;
  nom: string;
  prenom: string;
  matchedOn: ("TELEPHONE" | "EMAIL")[];
};

export async function findPotentialDuplicates(params: {
  organisationId: string;
  telephone?: string | null;
  email?: string | null;
  excludeLeadId?: string;
}): Promise<PotentialDuplicate[]> {
  const telephoneNormalise = normalizePhoneNumber(params.telephone);
  const emailNormalise = params.email?.trim().toLowerCase() || null;
  if (!telephoneNormalise && !emailNormalise) return [];

  // Filtrage final en JS (insensible à la casse pour l'email, tolérant aux
  // formats de téléphone pour le client) - la requête ne fait que réduire
  // le périmètre (au moins un des deux champs renseigné), la comparaison
  // exacte est faite ci-dessous pour rester correcte quelle que soit la
  // collation MySQL de la colonne.
  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: {
        organisationId: params.organisationId,
        id: params.excludeLeadId ? { not: params.excludeLeadId } : undefined,
        OR: [{ telephoneNormalise: { not: null } }, { email: { not: null } }],
      },
      select: { id: true, nom: true, prenom: true, telephoneNormalise: true, email: true },
    }),
    prisma.client.findMany({
      where: {
        organisationId: params.organisationId,
        OR: [{ telephone: { not: null } }, { email: { not: null } }],
      },
      select: { id: true, nom: true, prenom: true, telephone: true, email: true },
    }),
  ]);

  const results: PotentialDuplicate[] = [];

  for (const l of leads) {
    const matchedOn: PotentialDuplicate["matchedOn"] = [];
    if (telephoneNormalise && l.telephoneNormalise === telephoneNormalise) matchedOn.push("TELEPHONE");
    if (emailNormalise && l.email?.trim().toLowerCase() === emailNormalise) matchedOn.push("EMAIL");
    if (matchedOn.length > 0) results.push({ type: "LEAD", id: l.id, nom: l.nom, prenom: l.prenom, matchedOn });
  }

  for (const c of clients) {
    const matchedOn: PotentialDuplicate["matchedOn"] = [];
    if (telephoneNormalise && normalizePhoneNumber(c.telephone) === telephoneNormalise) matchedOn.push("TELEPHONE");
    if (emailNormalise && c.email?.trim().toLowerCase() === emailNormalise) matchedOn.push("EMAIL");
    if (matchedOn.length > 0) results.push({ type: "CLIENT", id: c.id, nom: c.nom, prenom: c.prenom, matchedOn });
  }

  return results;
}
