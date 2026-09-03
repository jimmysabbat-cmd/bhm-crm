import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { calculerDelaiEtape } from "@/lib/workflow";
import type { TypeTache } from "@/generated/prisma/enums";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const TYPE_TACHE_PAR_FLUX: Record<string, TypeTache> = {
  ANAH: "RELANCE_ANAH",
  CEE: "RELANCE_CEE",
  TRAVAUX: "RELANCE_SOUS_TRAITANT",
};

/**
 * Enregistre qu'une relance vient d'être effectuée sur une tâche : date,
 * compteur, prochaine échéance (bornée par maxRelances si la tâche est
 * liée à une RegleRelance). N'écrit jamais de logique dispersée ailleurs -
 * c'est le seul point d'entrée pour "faire une relance".
 */
export async function markRelanceDone(params: {
  tacheId: string;
  organisationId: string;
  userId: string;
  recurrenceJours?: number | null;
}) {
  const tache = await prisma.tache.findFirst({
    where: { id: params.tacheId, dossier: { organisationId: params.organisationId } },
    include: { regleRelance: true },
  });
  if (!tache) throw new Error("Tâche introuvable.");

  const nombreRelances = tache.nombreRelances + 1;
  const maxRelances = tache.regleRelance?.maxRelances ?? null;
  const recurrence = params.recurrenceJours ?? tache.regleRelance?.recurrenceJours ?? null;
  const atteintMax = maxRelances != null && nombreRelances >= maxRelances;

  const now = new Date();
  const prochaineRelanceAt = !atteintMax && recurrence ? addDays(now, recurrence) : null;

  await prisma.tache.update({
    where: { id: tache.id },
    data: {
      derniereRelanceAt: now,
      nombreRelances,
      prochaineRelanceAt,
      dateEcheance: prochaineRelanceAt ?? tache.dateEcheance,
    },
  });

  await logAudit({
    organisationId: params.organisationId,
    userId: params.userId,
    entityType: "Tache",
    entityId: tache.id,
    action: "RELANCE_EFFECTUEE",
    metadata: {
      dossierId: tache.dossierId,
      titre: tache.titre,
      nombreRelances,
      prochaineRelanceAt: prochaineRelanceAt?.toISOString() ?? null,
    },
  });

  return { nombreRelances, prochaineRelanceAt };
}

/**
 * Applique les RegleRelance actives d'une organisation : pour chaque étape
 * active correspondant à une règle et ayant dépassé apresJours sans tâche
 * de relance existante, crée LA tâche (une seule, jamais recréée - la
 * contrainte unique Tache(dossierEtapeId, regleRelanceId) le garantit).
 * Idempotent : peut être appelé autant de fois que nécessaire (ouverture du
 * dashboard, appel manuel...), jamais de cron dans cette V1.
 */
export async function evaluateRelanceRules(organisationId: string): Promise<{ tachesCreees: number }> {
  const regles = await prisma.regleRelance.findMany({ where: { organisationId, actif: true } });
  if (regles.length === 0) return { tachesCreees: 0 };

  let tachesCreees = 0;

  for (const regle of regles) {
    const etapesCandidates = await prisma.dossierEtape.findMany({
      where: {
        organisationId,
        statut: { in: ["A_FAIRE", "EN_COURS"] },
        etapeProgramme: {
          typeFlux: regle.typeFlux,
          ...(regle.typeAction ? { code: regle.typeAction } : {}),
        },
      },
      include: { etapeProgramme: true },
    });

    for (const de of etapesCandidates) {
      const delais = calculerDelaiEtape(de);
      if (delais.joursEcoules == null || delais.joursEcoules < regle.apresJours) continue;

      const existante = await prisma.tache.findUnique({
        where: { dossierEtapeId_regleRelanceId: { dossierEtapeId: de.id, regleRelanceId: regle.id } },
      });
      if (existante) continue;

      await prisma.tache.create({
        data: {
          dossierId: de.dossierId,
          type: TYPE_TACHE_PAR_FLUX[regle.typeFlux] ?? "AUTRE",
          titre: `Relance : ${de.etapeProgramme.nom}`,
          description: regle.nom,
          dateEcheance: new Date(),
          dossierEtapeId: de.id,
          regleRelanceId: regle.id,
          assigneAId: null,
        },
      });
      tachesCreees += 1;
    }
  }

  return { tachesCreees };
}
