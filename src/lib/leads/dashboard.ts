import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import { hasPermission } from "@/lib/authz";

// ============================================================
// Dashboard commercial (P9, section 32/33) - comptages simples depuis les
// données réelles, pas d'analytics complexe. Le funnel de conversion
// (section 33, finition P9 section 38) compte les leads ayant DÉJÀ ATTEINT
// chaque étape au moins une fois (via LeadStatusHistory), même si le lead
// est ensuite passé à un autre statut (ex. PERDU) - un lead qualifié puis
// perdu reste compté comme "a atteint QUALIFIÉ".
// ============================================================

export type CommercialDashboardMetrics = {
  nouveauxLeads: number;
  appelsAFaire: number;
  rappelsEnRetard: number;
  rdvAujourdhui: number;
  leadsQualifies: number;
  etudesAFaire: number;
  devisEnAttente: number;
  ventesSignees: number;
  tauxConversionPct: number | null;
  funnel: { etape: string; count: number }[];
};

const ETAPES_FUNNEL = ["NOUVEAU", "CONTACTE", "QUALIFIE", "RDV_PRIS", "ETUDE_FAITE", "DEVIS_ENVOYE", "SIGNE"];

export async function getCommercialDashboardMetrics(ctx: UserContext): Promise<CommercialDashboardMetrics | null> {
  if (!hasPermission(ctx, "VIEW_LEADS")) return null;

  const now = new Date();
  const debutJournee = new Date(now);
  debutJournee.setHours(0, 0, 0, 0);
  const finJournee = new Date(now);
  finJournee.setHours(23, 59, 59, 999);

  const scopeMine = !hasPermission(ctx, "VIEW_TEAM_LEADS");
  const scopeWhere = scopeMine ? { OR: [{ commercialId: ctx.userId }, { teleprospecteurId: ctx.userId }] } : {};

  const [nouveauxLeads, appelsAFaire, rappelsEnRetard, rdvAujourdhui, leadsQualifies, etudesAFaire, devisEnAttente, ventesSignees, totalNonPerdu, statuts] = await Promise.all([
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: "NOUVEAU" } } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: { in: ["NOUVEAU", "A_CONTACTER"] } }, prochainContactAt: null } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, prochainContactAt: { lt: now }, statut: { key: { notIn: ["SIGNE", "PERDU"] } } } }),
    prisma.rdv.count({ where: { organisationId: ctx.organisationId, date: { gte: debutJournee, lte: finJournee }, statut: { notIn: ["ANNULE"] }, commercialId: scopeMine ? ctx.userId : undefined } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: "QUALIFIE" } } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: "ETUDE_A_FAIRE" } } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: "DEVIS_ENVOYE" } } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: "SIGNE" } } }),
    prisma.lead.count({ where: { organisationId: ctx.organisationId, ...scopeWhere, statut: { key: { not: "PERDU" } } } }),
    prisma.leadPipelineStatus.findMany({ where: { key: { in: ETAPES_FUNNEL } }, select: { id: true, key: true } }),
  ]);

  const idByKey = new Map(statuts.map((s) => [s.key, s.id]));
  const funnel = await Promise.all(
    ETAPES_FUNNEL.map(async (key) => {
      const statutId = idByKey.get(key);
      if (!statutId) return { etape: key, count: 0 };
      // distinct leadId : un lead qui traverse deux fois le même statut ne
      // doit compter qu'une fois dans le funnel.
      const rows = await prisma.leadStatusHistory.findMany({
        where: { newStatusId: statutId, lead: { organisationId: ctx.organisationId, ...scopeWhere } },
        select: { leadId: true },
        distinct: ["leadId"],
      });
      return { etape: key, count: rows.length };
    })
  );

  return {
    nouveauxLeads,
    appelsAFaire,
    rappelsEnRetard,
    rdvAujourdhui,
    leadsQualifies,
    etudesAFaire,
    devisEnAttente,
    ventesSignees,
    tauxConversionPct: totalNonPerdu > 0 ? Math.round((ventesSignees / totalNonPerdu) * 1000) / 10 : null,
    funnel,
  };
}
