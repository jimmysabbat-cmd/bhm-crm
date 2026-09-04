import { prisma } from "@/lib/prisma";
import { getDocumentChecklistForDossier } from "./checklist";

// ============================================================
// Vue transversale "documents manquants" (P10, section 25) - agrège la
// checklist de chaque dossier actif, jamais une seconde logique de calcul
// (réutilise getDocumentChecklistForDossier).
// ============================================================

export type MissingDocumentRow = {
  dossierId: string;
  dossierReference: string;
  clientNom: string;
  typeDocumentNom: string;
  sourceLabel: string;
  responsible: string | null;
  destination: string | null;
  blocking: boolean;
  dossierCreatedAt: Date;
  ancienneteJours: number;
};

export async function getMissingDocumentsAcrossOrg(organisationId: string): Promise<MissingDocumentRow[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { organisationId, statut: { key: { not: "CLOTURE" } } },
    select: { id: true, reference: true, createdAt: true, client: { select: { prenom: true, nom: true } } },
  });

  const now = Date.now();
  const rows: MissingDocumentRow[] = [];
  for (const d of dossiers) {
    const checklist = await getDocumentChecklistForDossier(d.id, organisationId);
    for (const r of checklist.requirements) {
      if (r.status !== "MANQUANT") continue;
      rows.push({
        dossierId: d.id,
        dossierReference: d.reference,
        clientNom: `${d.client.prenom} ${d.client.nom}`,
        typeDocumentNom: r.typeDocumentNom,
        sourceLabel: r.sourceRequirement.label,
        responsible: r.responsible,
        destination: r.destination,
        blocking: r.blocking,
        dossierCreatedAt: d.createdAt,
        ancienneteJours: Math.floor((now - d.createdAt.getTime()) / 86_400_000),
      });
    }
  }
  return rows;
}
