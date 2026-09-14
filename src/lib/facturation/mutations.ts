import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { genererNumeroFactureDonneurOrdre } from "./numerotation";
import { genererEtEnregistrerPdfFactureDonneurOrdre } from "./pdf";
import { getDocumentStorageProvider } from "@/lib/storage";

// ============================================================
// P16 - logique de facturation (DONNEUR_ORDRE + SOUS_TRAITANT), extraite
// des Server Actions pour rester testable sans session NextAuth réelle -
// même principe que createMissionPackage (src/lib/documents/mission.ts).
// Les Server Actions (src/app/facturation/actions.ts,
// src/app/partenaire/facture-actions.ts) ne font que résoudre le contexte
// utilisateur puis déléguer ici.
//
// ATTENTION ABSOLUE (audit P6 préalable, cf. financial-engine.ts) : chaque
// facture ne crée JAMAIS plus d'un MouvementFinancier (contrainte unique
// Facture.mouvementFinancierId en base). Le moteur financier central reste
// l'unique source de vérité du règlement.
// ============================================================

const TVA_DEFAUT = 0.2;

export async function creerFactureDonneurOrdre(params: { organisationId: string; userId: string; dossierId: string; posteIds: string[]; dateEcheance: Date | null }) {
  const { organisationId, userId, dossierId, posteIds, dateEcheance } = params;
  if (posteIds.length === 0) throw new Error("Sélectionnez au moins un poste à facturer.");

  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { donneurOrdreId: true } });
  if (!dossier) throw new Error("Dossier introuvable.");
  if (!dossier.donneurOrdreId) throw new Error("Ce dossier n'est rattaché à aucun donneur d'ordre.");

  const postes = await prisma.dossierPosteTravaux.findMany({
    where: { id: { in: posteIds }, dossierId },
    select: {
      id: true,
      type: true,
      surfaceM2: true,
      montantDevisHTCts: true,
      montantDevisTTCCts: true,
      factureLignes: { select: { facture: { select: { statut: true } } } },
    },
  });
  if (postes.length !== posteIds.length) throw new Error("Poste introuvable.");
  if (postes.some((p) => p.factureLignes.some((l) => l.facture.statut !== "ANNULEE"))) {
    throw new Error("Un des postes sélectionnés est déjà facturé sur une facture active.");
  }
  if (postes.some((p) => !p.montantDevisHTCts)) {
    throw new Error("Un des postes sélectionnés n'a pas de montant devis HT renseigné.");
  }

  let montantHTCts = 0;
  let montantTVACts = 0;
  const lignesData = postes.map((p, i) => {
    const ht = p.montantDevisHTCts!;
    const tauxTVA = p.montantDevisTTCCts && p.montantDevisTTCCts > ht ? Math.round(((p.montantDevisTTCCts - ht) / ht) * 1000) / 1000 : TVA_DEFAUT;
    const tva = Math.round(ht * tauxTVA);
    montantHTCts += ht;
    montantTVACts += tva;
    return {
      posteTravauxId: p.id,
      designation: `${typeTravauxLabels[p.type] ?? p.type}${p.surfaceM2 ? ` — ${p.surfaceM2} m²` : ""}`,
      quantite: 1,
      prixUnitaireHTCts: ht,
      tauxTVA,
      montantHTCts: ht,
      ordre: i,
    };
  });

  const numero = await genererNumeroFactureDonneurOrdre(organisationId);

  const facture = await prisma.facture.create({
    data: {
      organisationId,
      dossierId,
      type: "DONNEUR_ORDRE",
      numero,
      donneurOrdreId: dossier.donneurOrdreId,
      montantHTCts,
      tauxTVA: montantHTCts > 0 ? Math.round((montantTVACts / montantHTCts) * 1000) / 1000 : TVA_DEFAUT,
      montantTVACts,
      montantTTCCts: montantHTCts + montantTVACts,
      dateEcheance,
      statut: "BROUILLON",
      createdById: userId,
      lignes: { create: lignesData },
    },
  });

  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "CREER", metadata: { dossierId, numero, montantTTCCts: facture.montantTTCCts } });

  return facture;
}

async function loadOwnedFacture(factureId: string, organisationId: string) {
  const facture = await prisma.facture.findFirst({ where: { id: factureId, organisationId } });
  if (!facture) throw new Error("Facture introuvable.");
  return facture;
}

export async function emettreFactureDonneurOrdre(params: { organisationId: string; userId: string; factureId: string }) {
  const { organisationId, userId, factureId } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (facture.type !== "DONNEUR_ORDRE") throw new Error("Action réservée aux factures donneur d'ordre.");
  if (facture.statut !== "BROUILLON") throw new Error("Cette facture a déjà été émise.");

  await genererEtEnregistrerPdfFactureDonneurOrdre(facture.id);

  const mouvement = await prisma.mouvementFinancier.create({
    data: {
      organisationId,
      dossierId: facture.dossierId,
      type: "ENTREE",
      categorie: "ENCAISSEMENT_DONNEUR_ORDRE",
      payeurType: "DONNEUR_ORDRE",
      montantPrevuCts: facture.montantTTCCts,
      datePrevue: facture.dateEcheance,
      statut: "A_RECEVOIR",
      origine: `Facture ${facture.numero}`,
      createdById: userId,
    },
  });

  await prisma.facture.update({ where: { id: facture.id }, data: { statut: "EMISE", dateEmission: new Date(), mouvementFinancierId: mouvement.id } });

  await logAudit({
    organisationId,
    userId,
    entityType: "Facture",
    entityId: facture.id,
    action: "EMETTRE",
    metadata: { numero: facture.numero, montantTTCCts: facture.montantTTCCts, mouvementFinancierId: mouvement.id },
  });

  return { dossierId: facture.dossierId };
}

export async function annulerFacture(params: { organisationId: string; userId: string; factureId: string }) {
  const { organisationId, userId, factureId } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);

  if (facture.mouvementFinancierId) {
    const mouvement = await prisma.mouvementFinancier.findUnique({ where: { id: facture.mouvementFinancierId }, select: { statut: true } });
    if (mouvement && (mouvement.statut === "RECU" || mouvement.statut === "PAYE" || mouvement.statut === "PARTIEL")) {
      throw new Error("Impossible d'annuler une facture déjà partiellement ou totalement réglée.");
    }
    if (mouvement) {
      await prisma.mouvementFinancier.update({ where: { id: facture.mouvementFinancierId }, data: { statut: "ANNULE" } });
    }
  }

  await prisma.facture.update({ where: { id: facture.id }, data: { statut: "ANNULEE" } });
  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "ANNULER", metadata: { numero: facture.numero } });

  return { dossierId: facture.dossierId };
}

export async function validerFactureSousTraitant(params: { organisationId: string; userId: string; factureId: string }) {
  const { organisationId, userId, factureId } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (facture.type !== "SOUS_TRAITANT") throw new Error("Action réservée aux factures sous-traitant.");
  if (facture.validatedAt) throw new Error("Cette facture a déjà été validée.");
  if (facture.statut === "ANNULEE") throw new Error("Cette facture est annulée.");

  const mouvement = await prisma.mouvementFinancier.create({
    data: {
      organisationId,
      dossierId: facture.dossierId,
      type: "SORTIE",
      categorie: "PAIEMENT_SOUS_TRAITANT",
      beneficiaireType: "SOUS_TRAITANT",
      montantPrevuCts: facture.montantTTCCts,
      datePrevue: facture.dateEcheance,
      statut: "A_PAYER",
      origine: `Facture ${facture.numero}`,
      createdById: userId,
    },
  });

  await prisma.facture.update({ where: { id: facture.id }, data: { validatedById: userId, validatedAt: new Date(), mouvementFinancierId: mouvement.id } });

  await logAudit({
    organisationId,
    userId,
    entityType: "Facture",
    entityId: facture.id,
    action: "VALIDER",
    metadata: { numero: facture.numero, montantTTCCts: facture.montantTTCCts, mouvementFinancierId: mouvement.id },
  });

  return { dossierId: facture.dossierId };
}

export async function deposerFactureSousTraitant(params: {
  organisationId: string;
  userId: string;
  sousTraitantId: string;
  packageId: string;
  numero: string;
  montantHTCts: number;
  tauxTVA: number;
  file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer>; size: number } | null;
}) {
  const { organisationId, userId, sousTraitantId, packageId, numero, montantHTCts, tauxTVA, file } = params;
  if (!numero.trim()) throw new Error("Le numéro de votre facture est obligatoire.");
  if (!Number.isFinite(montantHTCts) || montantHTCts <= 0) throw new Error("Montant HT invalide.");
  if (!Number.isFinite(tauxTVA) || tauxTVA < 0 || tauxTVA > 1) throw new Error("Taux de TVA invalide.");

  const mission = await prisma.transmissionPackage.findFirst({
    where: { id: packageId, organisationId, destinationSousTraitantId: sousTraitantId, status: "TERMINEE", posteTravauxId: { not: null } },
    select: { id: true, dossierId: true, posteTravauxId: true },
  });
  if (!mission) throw new Error("Mission introuvable, non terminée, ou ne vous appartenant pas.");

  const facturesExistantes = await prisma.facture.findMany({
    where: { organisationId, type: "SOUS_TRAITANT", sousTraitantId, statut: { not: "ANNULEE" } },
    select: { lignes: { select: { posteTravauxId: true } } },
  });
  if (facturesExistantes.some((f) => f.lignes.some((l) => l.posteTravauxId === mission.posteTravauxId))) {
    throw new Error("Une facture active existe déjà pour ce poste.");
  }

  const montantTVACts = Math.round(montantHTCts * tauxTVA);
  const montantTTCCts = montantHTCts + montantTVACts;

  let fichierPdfPath: string | null = null;
  if (file && file.size > 0) {
    const stored = await getDocumentStorageProvider().save(mission.dossierId, file);
    fichierPdfPath = stored.key;
  }

  const facture = await prisma.facture.create({
    data: {
      organisationId,
      dossierId: mission.dossierId,
      type: "SOUS_TRAITANT",
      numero,
      sousTraitantId,
      montantHTCts,
      tauxTVA,
      montantTVACts,
      montantTTCCts,
      statut: "EMISE",
      fichierPdfPath,
      createdById: userId,
      lignes: {
        create: [{ posteTravauxId: mission.posteTravauxId!, designation: `Facture sous-traitant ${numero}`, quantite: 1, prixUnitaireHTCts: montantHTCts, tauxTVA, montantHTCts, ordre: 0 }],
      },
    },
  });

  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "DEPOSER", metadata: { dossierId: mission.dossierId, numero, montantTTCCts } });

  return facture;
}
