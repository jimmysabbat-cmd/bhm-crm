import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { normalizePhoneNumber } from "@/lib/phone";
import { findPotentialDuplicates, type PotentialDuplicate } from "./dedup";
import { mapReponsesToStructuredFields, type MappableAnswer } from "@/lib/questionnaire/mapping";
import { recordInitialLeadStatus } from "./status";

// ============================================================
// Services métier Lead (P9). Fonctions de bibliothèque pures/testables,
// séparées des Server Actions (src/app/leads/lead-actions.ts) qui ne font
// qu'appliquer permission + session + revalidatePath autour.
// ============================================================

/**
 * Service central de création d'un lead (section 25) - point d'entrée
 * unique réutilisable plus tard par un import CSV ou une future API/
 * webhook, sans dupliquer la logique de normalisation/détection de
 * doublons à chaque appelant.
 */
export async function createLeadFromSource(params: {
  organisationId: string;
  createdById: string | null;
  sourceKey: string | null;
  sourceDetail?: string | null;
  prenom: string;
  nom: string;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  commercialId?: string | null;
  teleprospecteurId?: string | null;
  notes?: string | null;
}): Promise<{ leadId: string; duplicates: PotentialDuplicate[] }> {
  const duplicates = await findPotentialDuplicates({
    organisationId: params.organisationId,
    telephone: params.telephone,
    email: params.email,
  });

  const [source, statutNouveau] = await Promise.all([
    params.sourceKey ? prisma.leadSource.findUnique({ where: { key: params.sourceKey } }) : Promise.resolve(null),
    prisma.leadPipelineStatus.findUniqueOrThrow({ where: { key: "NOUVEAU" } }),
  ]);

  const lead = await prisma.lead.create({
    data: {
      organisationId: params.organisationId,
      sourceId: source?.id ?? null,
      sourceDetail: params.sourceDetail ?? null,
      prenom: params.prenom,
      nom: params.nom,
      telephone: params.telephone ?? null,
      telephoneNormalise: normalizePhoneNumber(params.telephone),
      email: params.email ?? null,
      adresse: params.adresse ?? null,
      codePostal: params.codePostal ?? null,
      ville: params.ville ?? null,
      statutId: statutNouveau.id,
      commercialId: params.commercialId ?? null,
      teleprospecteurId: params.teleprospecteurId ?? null,
      notes: params.notes ?? null,
      createdById: params.createdById,
    },
  });

  await recordInitialLeadStatus({ leadId: lead.id, statutId: statutNouveau.id, userId: params.createdById });

  // Pas d'entrée d'audit sans acteur humain réel (AuditLog.userId est une
  // FK obligatoire) - un lead créé par import/API sans créateur connu
  // (createdById null) reste donc sans trace d'audit individuelle, ce qui
  // est cohérent : l'audit journalise des ACTIONS humaines, pas des
  // événements système anonymes.
  if (params.createdById) await logAudit({
    organisationId: params.organisationId,
    userId: params.createdById,
    entityType: "Lead",
    entityId: lead.id,
    action: "LEAD_CREE",
    metadata: { source: params.sourceKey ?? "", nbDoublonsPotentiels: duplicates.length },
  });

  return { leadId: lead.id, duplicates };
}

/** Charge les réponses mappables (avec champMappe) du dernier questionnaire rempli par un lead. */
async function loadMappableReponsesForLead(leadId: string): Promise<MappableAnswer[]> {
  const reponseQuestionnaire = await prisma.reponseQuestionnaire.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: { reponses: { include: { question: { select: { code: true, champMappe: true } } } } },
  });
  if (!reponseQuestionnaire) return [];
  return reponseQuestionnaire.reponses.map((r) => ({
    code: r.question.code,
    champMappe: r.question.champMappe,
    valeurTexte: r.valeurTexte,
    valeurNombre: r.valeurNombre,
    valeurBool: r.valeurBool,
    valeurOptions: (r.valeurOptions as string[] | null) ?? null,
  }));
}

/**
 * Garantit qu'un dossier existe pour ce lead (section 13/14) - IDEMPOTENTE :
 * si lead.dossierId est déjà renseigné, retourne l'existant sans rien
 * créer. Réutilisée par simulerEtudeLead() (brouillon nécessaire à P8) ET
 * par convertLeadToDossier() (conversion explicite) - une seule fonction,
 * jamais deux chemins de création différents (section 14 : deux clics ne
 * doivent jamais créer deux dossiers).
 *
 * Le dossier créé porte le statut PROSPECT_ETUDE (jamais DEVIS_SIGNE, qui
 * affirmerait une signature qui n'a pas eu lieu) et le type MONOGESTE par
 * défaut (hypothèse documentée : la plupart des projets issus d'un lead
 * sont un seul geste CEE ; ajustable manuellement ensuite comme tout
 * dossier existant).
 */
export async function ensureDraftDossierForLead(
  leadId: string,
  ctx: UserContext
): Promise<{ dossierId: string; clientId: string; created: boolean }> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organisationId: ctx.organisationId } });
  if (!lead) throw new Error("Lead introuvable.");
  if (lead.dossierId && lead.clientId) {
    return { dossierId: lead.dossierId, clientId: lead.clientId, created: false };
  }

  const duplicates = await findPotentialDuplicates({
    organisationId: ctx.organisationId,
    telephone: lead.telephone,
    email: lead.email,
    excludeLeadId: lead.id,
  });
  const existingClientMatch = duplicates.find((d) => d.type === "CLIENT");

  const client = existingClientMatch
    ? await prisma.client.findUniqueOrThrow({ where: { id: existingClientMatch.id } })
    : await prisma.client.create({
        data: {
          organisationId: ctx.organisationId,
          prenom: lead.prenom,
          nom: lead.nom,
          email: lead.email,
          telephone: lead.telephone,
          adresse: lead.adresse,
          codePostal: lead.codePostal,
          ville: lead.ville,
        },
      });

  const reponses = await loadMappableReponsesForLead(leadId);
  const mapping = mapReponsesToStructuredFields(reponses);
  if (Object.keys(mapping.client).length > 0) {
    await prisma.client.update({ where: { id: client.id }, data: mapping.client });
  }

  const [type, statut] = await Promise.all([
    prisma.dossierType.findUniqueOrThrow({ where: { key: "MONOGESTE" } }),
    prisma.dossierStatus.findUniqueOrThrow({ where: { key: "PROSPECT_ETUDE" } }),
  ]);

  const dossier = await prisma.dossier.create({
    data: {
      reference: `LEAD-${lead.id.slice(-8).toUpperCase()}`,
      clientId: client.id,
      organisationId: ctx.organisationId,
      typeId: type.id,
      statutId: statut.id,
      montantDevisTTC: 0,
      delegataireCeeId: null,
      createdById: ctx.userId,
    },
  });

  if (mapping.projetTypeTravaux) {
    const logement = await prisma.logement.findUnique({ where: { leadId } });
    await prisma.dossierPosteTravaux.create({
      data: { dossierId: dossier.id, type: mapping.projetTypeTravaux, surfaceM2: logement?.surfaceChauffeeM2 ?? null },
    });
  }

  // Repointe le logement du lead vers le dossier (et le client, si celui-ci
  // n'a pas déjà son propre logement - jamais d'écrasement d'un logement
  // existant lié à un autre dossier).
  const logementDuLead = await prisma.logement.findUnique({ where: { leadId } });
  if (logementDuLead) {
    const clientADejaUnLogement = await prisma.logement.findUnique({ where: { clientId: client.id } });
    await prisma.logement.update({
      where: { id: logementDuLead.id },
      data: {
        dossierId: dossier.id,
        clientId: !clientADejaUnLogement || clientADejaUnLogement.id === logementDuLead.id ? client.id : undefined,
      },
    });
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { clientId: client.id, dossierId: dossier.id, convertedAt: new Date() } });

  await logAudit({
    organisationId: ctx.organisationId,
    userId: ctx.userId,
    entityType: "Dossier",
    entityId: dossier.id,
    action: "LEAD_CONVERTI_DOSSIER_CREE",
    metadata: { leadId: lead.id, clientId: client.id, clientReutilise: existingClientMatch != null },
  });

  return { dossierId: dossier.id, clientId: client.id, created: true };
}
