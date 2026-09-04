import { prisma } from "@/lib/prisma";
import { getDocumentChecklistForDossier } from "./checklist";

// ============================================================
// Relance client pour pièces manquantes (P10, section 22/23) - REGROUPÉE :
// une seule structure listant TOUTES les pièces manquantes du client pour
// ce dossier, jamais une par pièce. Pas d'envoi mail/SMS automatique
// (hors périmètre P10) - seulement la donnée structurée nécessaire pour
// qu'un humain relance (ou qu'un futur envoi automatique s'y branche).
// ============================================================

export type RelanceDocumentaireData = {
  dossierId: string;
  dossierReference: string;
  clientNom: string;
  documentsManquants: { typeDocumentNom: string; obligatoire: boolean }[];
  relanceCount: number;
  lastRelanceAt: Date | null;
};

export async function getMissingDocumentsRelanceData(dossierId: string, organisationId: string): Promise<RelanceDocumentaireData> {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, include: { client: { select: { prenom: true, nom: true } } } });
  if (!dossier) throw new Error("Dossier introuvable.");

  const checklist = await getDocumentChecklistForDossier(dossierId, organisationId);
  const documentsManquants = checklist.requirements
    .filter((r) => r.status === "MANQUANT" && r.responsible === "CLIENT")
    .map((r) => ({ typeDocumentNom: r.typeDocumentNom, obligatoire: r.required }));

  const relances = await prisma.auditLog.findMany({
    where: { organisationId, entityType: "Dossier", entityId: dossierId, action: "RELANCE_DOCUMENTS_DEMANDEE" },
    orderBy: { createdAt: "desc" },
  });

  return {
    dossierId,
    dossierReference: dossier.reference,
    clientNom: `${dossier.client.prenom} ${dossier.client.nom}`,
    documentsManquants,
    relanceCount: relances.length,
    lastRelanceAt: relances[0]?.createdAt ?? null,
  };
}
