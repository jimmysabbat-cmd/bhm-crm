import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { typeTravauxLabels } from "@/lib/dossier-labels";
import { genererNumeroFactureDonneurOrdre } from "./numerotation";
import { genererEtEnregistrerPdfFactureDonneurOrdre } from "./pdf";
import { getDocumentStorageProvider } from "@/lib/storage";
import type { TypeFacture, StatutFacture, ModeReglement } from "@/generated/prisma/enums";

type UploadableFile = { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer>; size: number };

// Statuts qui impliquent qu'un règlement (encaissement DO/client, ou
// paiement ST) a déjà eu lieu ou est attendu - la créance/dette
// MouvementFinancier doit alors exister (cf. ensureMouvementForFacture).
// Jamais BROUILLON/A_TRANSMETTRE/RECUE/A_CONTROLER/REFUSEE/ANNULEE, qui ne
// représentent aucun engagement financier constaté.
const STATUTS_AVEC_MOUVEMENT = new Set<StatutFacture>(["TRANSMISE", "VALIDEE", "A_PAYER", "PARTIELLEMENT_PAYEE", "PAYEE", "EN_RETARD"]);

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

// ============================================================
// Cœur anti-double-comptage (règle absolue) : UNE facture = AU PLUS UN
// MouvementFinancier (contrainte unique en base). Ce mouvement n'est jamais
// créé tant que rien n'est réellement engagé (transmission DO/client,
// validation ST) ; une fois créé, il est UNIQUEMENT recalculé (jamais
// recréé) à partir de la somme des ReglementFacture - jamais une resaisie
// manuelle du montant réglé. Le statut affiché de la facture peut être
// changé manuellement à tout moment (cf. changerStatutFacture) SANS jamais
// toucher au mouvement : la vérité financière (P6/P6C) ne dépend que des
// règlements réellement enregistrés, jamais d'une étiquette de statut.
// ============================================================

async function ensureMouvementForFacture(factureId: string, userId: string): Promise<string> {
  const facture = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
  if (facture.mouvementFinancierId) return facture.mouvementFinancierId;

  const estSortie = facture.type === "SOUS_TRAITANT";
  const categorie = facture.type === "SOUS_TRAITANT" ? "PAIEMENT_SOUS_TRAITANT" : facture.type === "CLIENT" ? "ENCAISSEMENT_CLIENT" : "ENCAISSEMENT_DONNEUR_ORDRE";

  const mouvement = await prisma.mouvementFinancier.create({
    data: {
      organisationId: facture.organisationId,
      dossierId: facture.dossierId,
      type: estSortie ? "SORTIE" : "ENTREE",
      categorie,
      payeurType: facture.type === "DONNEUR_ORDRE" ? "DONNEUR_ORDRE" : facture.type === "CLIENT" ? "CLIENT" : null,
      beneficiaireType: estSortie ? "SOUS_TRAITANT" : null,
      montantPrevuCts: facture.montantTTCCts,
      datePrevue: facture.dateEcheance,
      statut: estSortie ? "A_PAYER" : "A_RECEVOIR",
      origine: `Facture ${facture.numero}`,
      createdById: userId,
    },
  });

  await prisma.facture.update({ where: { id: facture.id }, data: { mouvementFinancierId: mouvement.id } });
  return mouvement.id;
}

/** Recalcule le mouvement lié (montant réel = somme des règlements) et le statut affiché - jamais l'inverse. Le mouvement DOIT déjà exister (invariant garanti par ensureMouvementForFacture, appelé avant tout premier règlement). */
async function recomputeFactureStatutAndMouvement(factureId: string): Promise<void> {
  const facture = await prisma.facture.findUniqueOrThrow({ where: { id: factureId }, include: { reglements: true } });
  if (!facture.mouvementFinancierId) throw new Error("Aucun mouvement financier lié - la facture doit être transmise/validée avant tout règlement.");

  const sommeCts = facture.reglements.reduce((s, r) => s + r.montantCts, 0);
  const estSortie = facture.type === "SOUS_TRAITANT";
  const soldee = sommeCts >= facture.montantTTCCts && facture.montantTTCCts > 0;

  await prisma.mouvementFinancier.update({
    where: { id: facture.mouvementFinancierId },
    data: {
      montantReelCts: sommeCts,
      dateReelle: sommeCts > 0 ? new Date() : null,
      statut: sommeCts <= 0 ? (estSortie ? "A_PAYER" : "A_RECEVOIR") : soldee ? (estSortie ? "PAYE" : "RECU") : "PARTIEL",
    },
  });

  // Ne jamais écraser un statut terminal (ANNULEE/REFUSEE) ni un statut
  // encore en amont de l'engagement (BROUILLON/A_TRANSMETTRE/RECUE/
  // A_CONTROLER) avec un état dérivé du règlement.
  if (facture.statut === "ANNULEE" || facture.statut === "REFUSEE") return;
  const nouveauStatut: StatutFacture = sommeCts <= 0 ? (estSortie ? "A_PAYER" : "TRANSMISE") : soldee ? "PAYEE" : "PARTIELLEMENT_PAYEE";
  await prisma.facture.update({ where: { id: facture.id }, data: { statut: nouveauStatut } });
}

export async function emettreFactureDonneurOrdre(params: { organisationId: string; userId: string; factureId: string }) {
  const { organisationId, userId, factureId } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (facture.type !== "DONNEUR_ORDRE") throw new Error("Action réservée aux factures donneur d'ordre.");
  if (facture.statut !== "BROUILLON") throw new Error("Cette facture a déjà été émise.");

  await genererEtEnregistrerPdfFactureDonneurOrdre(facture.id);
  const mouvementId = await ensureMouvementForFacture(facture.id, userId);
  await prisma.facture.update({ where: { id: facture.id }, data: { statut: "TRANSMISE", dateEmission: new Date() } });
  await prisma.factureTransmission.create({ data: { factureId: facture.id, destinataire: "Portail donneur d'ordre", transmisById: userId } });

  await logAudit({
    organisationId,
    userId,
    entityType: "Facture",
    entityId: facture.id,
    action: "EMETTRE",
    metadata: { numero: facture.numero, montantTTCCts: facture.montantTTCCts, mouvementFinancierId: mouvementId },
  });

  return { dossierId: facture.dossierId };
}

/**
 * Transmet une facture DONNEUR_ORDRE ou CLIENT déjà saisie manuellement
 * (dépôt MVP - cf. creerFactureManuelle) : jamais de PDF auto-généré ici,
 * seulement le passage BROUILLON/A_TRANSMETTRE -> TRANSMISE + naissance de
 * la créance P6 (une seule fois, cf. ensureMouvementForFacture) +
 * historique de transmission.
 */
export async function transmettreFacture(params: { organisationId: string; userId: string; factureId: string; destinataire: string }) {
  const { organisationId, userId, factureId, destinataire } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (facture.type === "SOUS_TRAITANT") throw new Error("Une facture sous-traitant se valide, elle ne se transmet pas.");
  if (facture.statut !== "BROUILLON" && facture.statut !== "A_TRANSMETTRE") throw new Error("Cette facture a déjà été transmise.");

  const mouvementId = await ensureMouvementForFacture(facture.id, userId);
  await prisma.facture.update({ where: { id: facture.id }, data: { statut: "TRANSMISE" } });
  await prisma.factureTransmission.create({ data: { factureId: facture.id, destinataire, transmisById: userId } });

  await logAudit({
    organisationId,
    userId,
    entityType: "Facture",
    entityId: facture.id,
    action: "TRANSMETTRE",
    metadata: { numero: facture.numero, destinataire, mouvementFinancierId: mouvementId },
  });

  return { dossierId: facture.dossierId };
}

/** Changement manuel de statut (section "je dois pouvoir modifier le statut si nécessaire") - ne touche JAMAIS au mouvement financier lié : la vérité financière ne vient que des règlements réels, jamais d'une étiquette. */
export async function changerStatutFacture(params: { organisationId: string; userId: string; factureId: string; statut: StatutFacture }) {
  const { organisationId, userId, factureId, statut } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);

  await prisma.facture.update({ where: { id: facture.id }, data: { statut } });
  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "CHANGER_STATUT", metadata: { numero: facture.numero, statutAvant: facture.statut, statutApres: statut } });

  return { dossierId: facture.dossierId };
}

/** Un règlement ne peut être ajouté qu'une fois la créance/dette née (transmission DO/client ou validation ST) - jamais avant, jamais sans mouvement à recalculer. */
export async function ajouterReglementFacture(params: {
  organisationId: string;
  userId: string;
  factureId: string;
  montantCts: number;
  date: Date;
  mode: ModeReglement;
  reference: string | null;
  commentaire: string | null;
}) {
  const { organisationId, userId, factureId, montantCts, date, mode, reference, commentaire } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (!facture.mouvementFinancierId) {
    throw new Error(facture.type === "SOUS_TRAITANT" ? "Validez d'abord la facture avant d'enregistrer un règlement." : "Transmettez d'abord la facture avant d'enregistrer un règlement.");
  }
  if (!Number.isFinite(montantCts) || montantCts <= 0) throw new Error("Montant de règlement invalide.");

  const reglement = await prisma.reglementFacture.create({
    data: { factureId: facture.id, montantCts, date, mode, reference, commentaire, createdById: userId },
  });
  await recomputeFactureStatutAndMouvement(facture.id);

  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "AJOUTER_REGLEMENT", metadata: { numero: facture.numero, montantCts, mode } });

  return { dossierId: facture.dossierId, reglementId: reglement.id };
}

export async function supprimerReglementFacture(params: { organisationId: string; userId: string; reglementId: string }) {
  const { organisationId, userId, reglementId } = params;
  const reglement = await prisma.reglementFacture.findFirst({ where: { id: reglementId, facture: { organisationId } }, include: { facture: true } });
  if (!reglement) throw new Error("Règlement introuvable.");

  await prisma.reglementFacture.delete({ where: { id: reglement.id } });
  await recomputeFactureStatutAndMouvement(reglement.factureId);

  await logAudit({ organisationId, userId, entityType: "Facture", entityId: reglement.factureId, action: "SUPPRIMER_REGLEMENT", metadata: { numero: reglement.facture.numero, montantCts: reglement.montantCts } });

  return { dossierId: reglement.facture.dossierId };
}

/**
 * Dépôt manuel MVP (aucune génération automatique) : le PDF vient de
 * l'extérieur, les montants sont saisis directement. Couvre les 3 types
 * depuis l'interne (CLIENT/DONNEUR_ORDRE/SOUS_TRAITANT), y compris la
 * "reprise" d'une facture déjà transmise/réglée (statutInitial +
 * montantDejaRegleCts) sans rejouer artificiellement le workflow complet.
 */
export async function creerFactureManuelle(params: {
  organisationId: string;
  userId: string;
  dossierId: string;
  type: TypeFacture;
  posteTravauxId: string | null;
  sousTraitantId: string | null;
  numero: string;
  dateFacture: Date;
  dateEcheance: Date | null;
  montantHTCts: number;
  tauxTVA: number;
  commentaire: string | null;
  file: UploadableFile | null;
  statutInitial: StatutFacture | null;
  montantDejaRegleCts: number;
  reglementDate: Date | null;
  reglementMode: ModeReglement | null;
  reglementReference: string | null;
}) {
  const {
    organisationId,
    userId,
    dossierId,
    type,
    posteTravauxId,
    sousTraitantId,
    numero,
    dateFacture,
    dateEcheance,
    montantHTCts,
    tauxTVA,
    commentaire,
    file,
    statutInitial,
    montantDejaRegleCts,
    reglementDate,
    reglementMode,
    reglementReference,
  } = params;

  if (!numero.trim()) throw new Error("Le numéro de facture est obligatoire.");
  if (!Number.isFinite(montantHTCts) || montantHTCts <= 0) throw new Error("Montant HT invalide.");
  if (!Number.isFinite(tauxTVA) || tauxTVA < 0 || tauxTVA > 1) throw new Error("Taux de TVA invalide.");

  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { id: true, donneurOrdreId: true } });
  if (!dossier) throw new Error("Dossier introuvable.");

  let donneurOrdreId: string | null = null;
  if (type === "DONNEUR_ORDRE") {
    if (!dossier.donneurOrdreId) throw new Error("Ce dossier n'est rattaché à aucun donneur d'ordre.");
    donneurOrdreId = dossier.donneurOrdreId;
  }
  if (type === "SOUS_TRAITANT") {
    if (!sousTraitantId) throw new Error("Sélectionnez le sous-traitant concerné.");
    const st = await prisma.sousTraitant.findFirst({ where: { id: sousTraitantId, organisationId }, select: { id: true } });
    if (!st) throw new Error("Sous-traitant introuvable.");
  }
  if (posteTravauxId) {
    const poste = await prisma.dossierPosteTravaux.findFirst({ where: { id: posteTravauxId, dossierId }, select: { id: true, type: true } });
    if (!poste) throw new Error("Poste de travaux introuvable.");
  }

  const montantTVACts = Math.round(montantHTCts * tauxTVA);
  const montantTTCCts = montantHTCts + montantTVACts;

  let fichierPdfPath: string | null = null;
  if (file && file.size > 0) {
    const stored = await getDocumentStorageProvider().save(dossierId, file);
    fichierPdfPath = stored.key;
  }

  const statutDefaut: StatutFacture = type === "SOUS_TRAITANT" ? "RECUE" : "BROUILLON";
  const statut = statutInitial ?? statutDefaut;

  let poste: { type: string } | null = null;
  if (posteTravauxId) {
    poste = await prisma.dossierPosteTravaux.findUnique({ where: { id: posteTravauxId }, select: { type: true } });
  }

  const facture = await prisma.facture.create({
    data: {
      organisationId,
      dossierId,
      type,
      numero,
      donneurOrdreId,
      sousTraitantId: type === "SOUS_TRAITANT" ? sousTraitantId : null,
      montantHTCts,
      tauxTVA,
      montantTVACts,
      montantTTCCts,
      dateEmission: dateFacture,
      dateEcheance,
      statut,
      fichierPdfPath,
      createdById: userId,
      lignes: {
        create: [
          {
            posteTravauxId,
            designation: commentaire || (poste ? typeTravauxLabels[poste.type as keyof typeof typeTravauxLabels] ?? poste.type : `Facture ${numero}`),
            quantite: 1,
            prixUnitaireHTCts: montantHTCts,
            tauxTVA,
            montantHTCts,
            ordre: 0,
          },
        ],
      },
    },
  });

  if (STATUTS_AVEC_MOUVEMENT.has(statut)) {
    await ensureMouvementForFacture(facture.id, userId);
    if (statut === "TRANSMISE" || statut === "A_PAYER" || statut === "VALIDEE") {
      await prisma.factureTransmission.create({ data: { factureId: facture.id, destinataire: "Reprise - déjà transmise avant usage du CRM", transmisById: userId } });
    }
  }

  if (montantDejaRegleCts > 0) {
    if (!STATUTS_AVEC_MOUVEMENT.has(statut)) {
      throw new Error("Pour renseigner un montant déjà réglé, choisissez un statut initial déjà transmis/validé (reprise).");
    }
    await prisma.reglementFacture.create({
      data: {
        factureId: facture.id,
        montantCts: montantDejaRegleCts,
        date: reglementDate ?? dateFacture,
        mode: reglementMode ?? "AUTRE",
        reference: reglementReference,
        commentaire: "Solde initial saisi à la reprise",
        createdById: userId,
      },
    });
    await recomputeFactureStatutAndMouvement(facture.id);
  }

  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "CREER_MANUELLE", metadata: { dossierId, type, numero, montantTTCCts, statutInitial: statut } });

  return facture;
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
  if (facture.statut === "ANNULEE" || facture.statut === "REFUSEE") throw new Error("Cette facture est annulée ou refusée.");

  const mouvementId = await ensureMouvementForFacture(facture.id, userId);
  await prisma.facture.update({ where: { id: facture.id }, data: { validatedById: userId, validatedAt: new Date(), statut: "A_PAYER" } });

  await logAudit({
    organisationId,
    userId,
    entityType: "Facture",
    entityId: facture.id,
    action: "VALIDER",
    metadata: { numero: facture.numero, montantTTCCts: facture.montantTTCCts, mouvementFinancierId: mouvementId },
  });

  return { dossierId: facture.dossierId };
}

/** Refus d'une facture ST déposée (avant validation uniquement - une fois validée, la dette est réelle, on annule plutôt que refuser). */
export async function refuserFactureSousTraitant(params: { organisationId: string; userId: string; factureId: string; motif: string | null }) {
  const { organisationId, userId, factureId, motif } = params;
  const facture = await loadOwnedFacture(factureId, organisationId);
  if (facture.type !== "SOUS_TRAITANT") throw new Error("Action réservée aux factures sous-traitant.");
  if (facture.validatedAt) throw new Error("Cette facture est déjà validée - annulez-la plutôt que la refuser.");

  await prisma.facture.update({ where: { id: facture.id }, data: { statut: "REFUSEE" } });
  await logAudit({ organisationId, userId, entityType: "Facture", entityId: facture.id, action: "REFUSER", metadata: { numero: facture.numero, motif } });

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
      statut: "RECUE",
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
