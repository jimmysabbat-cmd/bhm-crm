import { prisma } from "@/lib/prisma";
import type { StatutDossierEtape } from "@/generated/prisma/enums";

const TERMINAL_STATUTS: StatutDossierEtape[] = ["TERMINE", "IGNORE", "ANNULE"];

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Recalcule le workflow d'un dossier : instancie les DossierEtape
 * manquantes pour la ProgrammeVersion du dossier, promeut les étapes dont
 * les dépendances sont satisfaites, et crée les tâches automatiques
 * manquantes. Idempotent : peut être appelé autant de fois que nécessaire
 * sans créer de doublons ni modifier une étape déjà avancée/bloquée/
 * terminée. No-op si le dossier n'a pas de programme affecté.
 *
 * Toute la logique de workflow vit ici - jamais dans les pages/actions.
 */
export async function recalculateDossierWorkflow(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { id: true, organisationId: true, programmeVersionId: true },
  });
  if (!dossier || !dossier.programmeVersionId) return;

  const [etapesProgramme, dossierEtapesExistantes] = await Promise.all([
    prisma.etapeProgramme.findMany({
      where: { programmeVersionId: dossier.programmeVersionId, actif: true },
      include: { dependances: true, modelesTaches: { where: { actif: true } } },
      orderBy: { ordre: "asc" },
    }),
    prisma.dossierEtape.findMany({ where: { dossierId } }),
  ]);

  const parEtapeId = new Map(dossierEtapesExistantes.map((de) => [de.etapeProgrammeId, de]));

  // 1) Instancier les DossierEtape manquantes (NON_DISPONIBLE par défaut).
  for (const etape of etapesProgramme) {
    if (parEtapeId.has(etape.id)) continue;
    const created = await prisma.dossierEtape.create({
      data: {
        organisationId: dossier.organisationId,
        dossierId,
        etapeProgrammeId: etape.id,
        statut: "NON_DISPONIBLE",
      },
    });
    parEtapeId.set(etape.id, created);
  }

  // 2) Promouvoir les étapes NON_DISPONIBLE dont les dépendances sont
  //    satisfaites (ALL_COMPLETED - toutes les étapes dont elle dépend
  //    doivent être TERMINE). Une étape sans dépendance déclarée est
  //    immédiatement disponible. On ne touche jamais aux étapes déjà
  //    avancées, bloquées ou terminées (idempotence).
  const now = new Date();
  for (const etape of etapesProgramme) {
    const de = parEtapeId.get(etape.id)!;
    if (de.statut !== "NON_DISPONIBLE") continue;

    const depsSatisfaites = etape.dependances.every((dep) => {
      const depDe = parEtapeId.get(dep.dependsOnEtapeId);
      return depDe?.statut === "TERMINE";
    });
    if (!depsSatisfaites) continue;

    const dateEcheance = etape.delaiNormalJours != null ? addDays(now, etape.delaiNormalJours) : null;
    const updated = await prisma.dossierEtape.update({
      where: { id: de.id },
      data: { statut: "A_FAIRE", dateDisponible: now, dateEcheance },
    });
    parEtapeId.set(etape.id, updated);
  }

  // 3) Créer les tâches automatiques manquantes pour les étapes A_FAIRE.
  //    Idempotent grâce à la contrainte unique Tache(dossierEtapeId,
  //    modeleTacheEtapeId) - on vérifie d'abord pour éviter une erreur SQL
  //    inutile, la contrainte reste le filet de sécurité.
  for (const etape of etapesProgramme) {
    const de = parEtapeId.get(etape.id)!;
    if (de.statut !== "A_FAIRE") continue;

    for (const modele of etape.modelesTaches) {
      const dejaCreee = await prisma.tache.findUnique({
        where: {
          dossierEtapeId_modeleTacheEtapeId: { dossierEtapeId: de.id, modeleTacheEtapeId: modele.id },
        },
      });
      if (dejaCreee) continue;

      await prisma.tache.create({
        data: {
          dossierId,
          type: modele.type,
          titre: modele.titre,
          description: modele.description,
          dateEcheance: addDays(now, modele.delaiJours),
          dossierEtapeId: de.id,
          modeleTacheEtapeId: modele.id,
        },
      });
    }
  }
}

export function joursEcoules(depuis: Date | null): number | null {
  if (!depuis) return null;
  return Math.floor((Date.now() - depuis.getTime()) / 86_400_000);
}

export function joursRestants(echeance: Date | null): number | null {
  if (!echeance) return null;
  return Math.ceil((echeance.getTime() - Date.now()) / 86_400_000);
}

export function estEnRetard(echeance: Date | null, statut: StatutDossierEtape): boolean {
  if (!echeance) return false;
  if (TERMINAL_STATUTS.includes(statut)) return false;
  return echeance.getTime() < Date.now();
}

export function calculerDelaiEtape(etape: {
  dateDisponible: Date | null;
  dateEcheance: Date | null;
  statut: StatutDossierEtape;
}) {
  const enRetard = estEnRetard(etape.dateEcheance, etape.statut);
  const restants = joursRestants(etape.dateEcheance);
  return {
    joursEcoules: joursEcoules(etape.dateDisponible),
    joursRestants: restants,
    enRetard,
    joursRetard: enRetard && restants != null ? Math.abs(restants) : 0,
  };
}

/**
 * Étapes actives d'un dossier (A_FAIRE / EN_COURS / BLOQUE), avec de quoi
 * afficher une liste d'actions à faire. Ne fait aucun classement financier
 * - juste le workflow (le "Next Best Action" complet viendra ensuite).
 */
export async function getNextActionsForDossier(dossierId: string) {
  const etapes = await prisma.dossierEtape.findMany({
    where: { dossierId, statut: { in: ["A_FAIRE", "EN_COURS", "BLOQUE"] } },
    include: {
      etapeProgramme: { select: { nom: true, ordre: true, roleResponsable: true } },
      assignedUser: { select: { id: true, name: true } },
    },
    orderBy: { etapeProgramme: { ordre: "asc" } },
  });

  return etapes.map((de) => {
    const delais = calculerDelaiEtape(de);
    return {
      dossierEtapeId: de.id,
      nom: de.etapeProgramme.nom,
      statut: de.statut,
      responsable: de.assignedUser?.name ?? de.etapeProgramme.roleResponsable ?? null,
      echeance: de.dateEcheance,
      retard: delais.joursRetard,
      raisonBlocage: de.raisonBlocage,
    };
  });
}

/**
 * Statut de présence des documents requis par une étape (intégration
 * additive au système Documents existant - aucune refonte).
 */
export async function documentsRequisStatus(dossierId: string, etapeProgrammeId: string) {
  const [requis, documents] = await Promise.all([
    prisma.etapeDocumentRequis.findMany({ where: { etapeProgrammeId } }),
    prisma.dossierDocument.findMany({ where: { dossierId }, select: { type: true } }),
  ]);
  const typesPresents = new Set(documents.map((d) => d.type));
  return requis.map((r) => ({
    typeDocument: r.typeDocument,
    obligatoire: r.obligatoire,
    present: typesPresents.has(r.typeDocument),
  }));
}
