import { prisma } from "@/lib/prisma";

// ============================================================
// Opérations plateforme sur les organisations (P12, sections 14/15/16) -
// réservées au PLATFORM SUPER ADMIN (vérifié par l'appelant via
// requirePlatformContext(), jamais ici). Aucun champ obligatoire au-delà
// de nom/slug pour ne pas bloquer la création d'un tenant dont les
// informations légales ne sont pas encore toutes connues.
// ============================================================

function slugify(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createOrganisation(params: {
  nom: string;
  raisonSociale?: string | null;
  siret?: string | null;
  tva?: string | null;
  adresse?: string | null;
  email?: string | null;
  telephone?: string | null;
}): Promise<string> {
  const baseSlug = slugify(params.nom) || `tenant-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 1;
  // Un slug doit rester unique - jamais d'échec brut sur une simple
  // collision de nom (ex. deux tenants nommés similairement).
  while (await prisma.organisation.findUnique({ where: { slug }, select: { id: true } })) {
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }

  const org = await prisma.organisation.create({
    data: {
      nom: params.nom,
      slug,
      status: "ACTIVE",
      raisonSociale: params.raisonSociale || null,
      siret: params.siret || null,
      tva: params.tva || null,
      adresse: params.adresse || null,
      email: params.email || null,
      telephone: params.telephone || null,
    },
  });
  return org.id;
}

export async function getPlatformOrganisations() {
  const orgs = await prisma.organisation.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { users: true, dossiers: true, clients: true, leads: true } } },
  });
  return orgs;
}

export async function setOrganisationStatus(organisationId: string, status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"): Promise<void> {
  await prisma.organisation.update({ where: { id: organisationId }, data: { status } });
}
