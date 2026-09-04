import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import { hasPermission } from "@/lib/authz";

// ============================================================
// getNextLeadToCall() (P9, section 22) - priorisation DÉTERMINISTE, aucun
// ML. Un lead déjà programmé pour plus tard (prochainContactAt futur)
// n'est jamais proposé maintenant ; un lead déjà "en ligne" chez un autre
// téléprospecteur (claim actif non expiré) non plus (section 23).
// ============================================================

export type NextLeadCandidate = {
  leadId: string;
  nom: string;
  prenom: string;
  telephone: string | null;
  ville: string | null;
  statutKey: string;
  priorityScore: number;
  reasons: string[];
};

const STATUTS_EXCLUS = ["SIGNE", "PERDU"];

export async function getNextLeadsToCall(ctx: UserContext, limit = 10): Promise<NextLeadCandidate[]> {
  if (!hasPermission(ctx, "VIEW_LEADS")) return [];
  const now = new Date();

  const voitEquipe = hasPermission(ctx, "VIEW_TEAM_LEADS");
  const leads = await prisma.lead.findMany({
    where: {
      organisationId: ctx.organisationId,
      convertedAt: null,
      statut: { key: { notIn: STATUTS_EXCLUS } },
      OR: [{ prochainContactAt: null }, { prochainContactAt: { lte: now } }],
      AND: [
        {
          OR: [{ claimedById: null }, { claimExpiresAt: { lte: now } }, { claimedById: ctx.userId }],
        },
        voitEquipe
          ? {}
          : {
              OR: [{ commercialId: ctx.userId }, { teleprospecteurId: ctx.userId }, { commercialId: null, teleprospecteurId: null }],
            },
      ],
    },
    select: {
      id: true,
      nom: true,
      prenom: true,
      telephone: true,
      ville: true,
      statut: { select: { key: true } },
      temperature: true,
      prochainContactAt: true,
      commercialId: true,
      teleprospecteurId: true,
      createdAt: true,
      _count: { select: { interactions: true } },
    },
  });

  const candidates: NextLeadCandidate[] = leads.map((l) => {
    const reasons: string[] = [];
    let score = 0;

    if (l.prochainContactAt && l.prochainContactAt.getTime() <= now.getTime()) {
      const joursRetard = Math.max(0, Math.floor((now.getTime() - l.prochainContactAt.getTime()) / 86_400_000));
      score += Math.min(joursRetard * 15 + 20, 150);
      reasons.push(joursRetard > 0 ? `Rappel en retard de ${joursRetard} jour(s)` : "Rappel prévu aujourd'hui");
    }

    if (l.statut.key === "NOUVEAU") {
      score += 20;
      reasons.push("Lead nouveau, jamais contacté");
    } else if (l.statut.key === "A_CONTACTER") {
      score += 15;
      reasons.push("À contacter");
    } else if (l.statut.key === "A_RAPPELER") {
      score += 10;
      reasons.push("À rappeler");
    }

    if (l.temperature === "CHAUD") {
      score += 15;
      reasons.push("Température chaud");
    } else if (l.temperature === "FROID") {
      score -= 5;
      reasons.push("Température froid");
    }

    const joursAnciennete = Math.floor((now.getTime() - l.createdAt.getTime()) / 86_400_000);
    score += Math.min(joursAnciennete * 0.5, 15);
    if (joursAnciennete > 3) reasons.push(`Créé il y a ${joursAnciennete} jour(s)`);

    if (l._count.interactions === 0) {
      score += 5;
      reasons.push("Aucune tentative de contact encore");
    }

    if (l.commercialId === ctx.userId || l.teleprospecteurId === ctx.userId) {
      score += 5;
      reasons.push("Vous êtes assigné à ce lead");
    }

    return {
      leadId: l.id,
      nom: l.nom,
      prenom: l.prenom,
      telephone: l.telephone,
      ville: l.ville,
      statutKey: l.statut.key,
      priorityScore: Math.round(score),
      reasons,
    };
  });

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  return candidates.slice(0, limit);
}

export async function getNextLeadToCall(ctx: UserContext): Promise<NextLeadCandidate | null> {
  const [top] = await getNextLeadsToCall(ctx, 1);
  return top ?? null;
}
