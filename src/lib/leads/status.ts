import { prisma } from "@/lib/prisma";

// ============================================================
// Changement de statut pipeline centralisé (P9, finition section 38) - une
// seule fonction réutilisée par tous les points d'écriture (résultat
// d'appel, RDV, édition manuelle, création) pour garantir qu'AUCUN
// changement de statut n'échappe à l'historique. Le funnel de conversion
// peut ainsi compter "a déjà atteint QUALIFIÉ" même si le lead est ensuite
// marqué PERDU, ce que le seul statut courant ne peut pas exprimer.
// ============================================================

export async function changeLeadStatus(params: { leadId: string; newStatusId: string; userId: string | null }): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: params.leadId }, select: { statutId: true } });
  if (lead.statutId === params.newStatusId) return;

  await prisma.$transaction([
    prisma.lead.update({ where: { id: params.leadId }, data: { statutId: params.newStatusId } }),
    prisma.leadStatusHistory.create({
      data: { leadId: params.leadId, oldStatusId: lead.statutId, newStatusId: params.newStatusId, userId: params.userId },
    }),
  ]);
}

/** À utiliser uniquement à la création du lead (oldStatusId volontairement null). */
export async function recordInitialLeadStatus(params: { leadId: string; statutId: string; userId: string | null }): Promise<void> {
  await prisma.leadStatusHistory.create({
    data: { leadId: params.leadId, oldStatusId: null, newStatusId: params.statutId, userId: params.userId },
  });
}

/** Le lead a-t-il déjà atteint ce statut à un moment donné, même s'il est ensuite passé à un autre (ex. PERDU) ? */
export async function hasLeadEverReachedStatus(leadId: string, statutId: string): Promise<boolean> {
  const entry = await prisma.leadStatusHistory.findFirst({ where: { leadId, newStatusId: statutId } });
  return entry != null;
}
