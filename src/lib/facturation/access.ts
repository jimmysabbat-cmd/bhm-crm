import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import type { StatutFacture, StatutMouvementFinancier } from "@/generated/prisma/enums";

// ============================================================
// P16 - couche d'accès facturation (DONNEUR_ORDRE + SOUS_TRAITANT).
//
// Principe directeur : Facture.statut ne porte QUE le cycle de vie du
// document lui-même (BROUILLON -> EMISE -> ANNULEE, ou LITIGE en cas de
// contestation manuelle). Le règlement (payée/partiellement payée/en
// retard) n'est JAMAIS un second état stocké en parallèle - il est dérivé
// en lecture du MouvementFinancier lié (source de vérité unique du moteur
// financier central, cf. financial-engine.ts), exactement comme les
// créances/dettes du reste du CRM (jamais de table dédiée, cf. commentaire
// au-dessus de getCreancesForDossier). Ça garantit qu'une facture ne peut
// jamais afficher "payée" sans qu'un mouvement financier réel ne l'atteste,
// et qu'un même paiement ne peut jamais être compté par deux mécanismes
// différents.
// ============================================================

export type FactureStatutAffiche = StatutFacture;

export function deriveFactureStatutAffiche(
  facture: { statut: StatutFacture; dateEcheance: Date | null },
  mouvement: { statut: StatutMouvementFinancier } | null
): FactureStatutAffiche {
  if (facture.statut === "ANNULEE" || facture.statut === "BROUILLON" || facture.statut === "LITIGE") return facture.statut;
  if (mouvement) {
    if (mouvement.statut === "RECU" || mouvement.statut === "PAYE") return "PAYEE";
    if (mouvement.statut === "PARTIEL") return "PARTIELLEMENT_PAYEE";
  }
  if (facture.dateEcheance && facture.dateEcheance.getTime() < Date.now()) return "EN_RETARD";
  return "EMISE";
}

function requireSousTraitant(ctx: UserContext): string {
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) throw new Error("Accès réservé aux sous-traitants.");
  return ctx.sousTraitantId;
}

// --- Facture DONNEUR_ORDRE : préparation côté interne -----------------------

export type PosteFacturableDonneurOrdre = {
  id: string;
  type: string;
  surfaceM2: number | null;
  quantite: number | null;
  montantDevisHTCts: number;
  montantDevisTTCCts: number | null;
  dejaFacture: boolean;
};

/** Postes du dossier dont le montant devis HT est connu, avec indication de ceux déjà présents sur une facture DO non annulée (jamais une resaisie, jamais un double comptage). */
export async function getPostesFacturablesDonneurOrdre(dossierId: string, organisationId: string): Promise<PosteFacturableDonneurOrdre[]> {
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, organisationId }, select: { id: true } });
  if (!dossier) throw new Error("Dossier introuvable.");

  const postes = await prisma.dossierPosteTravaux.findMany({
    where: { dossierId, montantDevisHTCts: { not: null } },
    select: {
      id: true,
      type: true,
      surfaceM2: true,
      quantite: true,
      montantDevisHTCts: true,
      montantDevisTTCCts: true,
      factureLignes: { select: { id: true, facture: { select: { statut: true } } } },
    },
  });

  return postes.map((p) => ({
    id: p.id,
    type: p.type,
    surfaceM2: p.surfaceM2,
    quantite: p.quantite,
    montantDevisHTCts: p.montantDevisHTCts!,
    montantDevisTTCCts: p.montantDevisTTCCts,
    dejaFacture: p.factureLignes.some((l) => l.facture.statut !== "ANNULEE"),
  }));
}

// --- Listes de factures (interne, cockpit dossier) --------------------------

export type FactureDossierRow = {
  id: string;
  type: "DONNEUR_ORDRE" | "SOUS_TRAITANT";
  numero: string;
  destinataireNom: string;
  montantHTCts: number;
  montantTTCCts: number;
  dateEmission: Date;
  dateEcheance: Date | null;
  statutAffiche: FactureStatutAffiche;
  validatedAt: Date | null;
  fichierPdfPath: string | null;
  mouvementFinancierId: string | null;
};

export async function getFacturesForDossier(dossierId: string, organisationId: string): Promise<FactureDossierRow[]> {
  const factures = await prisma.facture.findMany({
    where: { dossierId, organisationId },
    include: { donneurOrdre: { select: { nom: true } }, sousTraitant: { select: { nom: true } }, mouvementFinancier: { select: { id: true, statut: true } } },
    orderBy: { createdAt: "desc" },
  });

  return factures.map((f) => ({
    id: f.id,
    type: f.type,
    numero: f.numero,
    destinataireNom: f.donneurOrdre?.nom ?? f.sousTraitant?.nom ?? "—",
    montantHTCts: f.montantHTCts,
    montantTTCCts: f.montantTTCCts,
    dateEmission: f.dateEmission,
    dateEcheance: f.dateEcheance,
    statutAffiche: deriveFactureStatutAffiche(f, f.mouvementFinancier),
    validatedAt: f.validatedAt,
    fichierPdfPath: f.fichierPdfPath,
    mouvementFinancierId: f.mouvementFinancierId,
  }));
}

// --- Portail sous-traitant : missions facturables + mes factures ------------

export type MissionFacturableRow = {
  packageId: string;
  dossierId: string;
  dossierReference: string;
  posteTravauxId: string;
  posteType: string | null;
  prixConvenuCts: number | null;
  factureExistante: { id: string; numero: string; statutAffiche: FactureStatutAffiche } | null;
};

/** Missions TERMINEE de ce sous-traitant, avec indication de la facture déjà déposée le cas échéant (jamais un second dépôt tant que la première n'est pas annulée). */
export async function getMissionsFacturablesSousTraitant(ctx: UserContext): Promise<MissionFacturableRow[]> {
  const sousTraitantId = requireSousTraitant(ctx);

  const missions = await prisma.transmissionPackage.findMany({
    where: { organisationId: ctx.organisationId, destinationSousTraitantId: sousTraitantId, status: "TERMINEE", posteTravauxId: { not: null } },
    select: {
      id: true,
      dossierId: true,
      prixConvenuCts: true,
      dossier: { select: { reference: true } },
      posteTravauxId: true,
      posteTravaux: { select: { type: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const factures = await prisma.facture.findMany({
    where: { organisationId: ctx.organisationId, type: "SOUS_TRAITANT", sousTraitantId, dossierId: { in: missions.map((m) => m.dossierId) } },
    include: { mouvementFinancier: { select: { statut: true } }, lignes: { select: { posteTravauxId: true } } },
  });

  return missions.map((m) => {
    const facture = factures.find((f) => f.statut !== "ANNULEE" && f.lignes.some((l) => l.posteTravauxId === m.posteTravauxId));
    return {
      packageId: m.id,
      dossierId: m.dossierId,
      dossierReference: m.dossier.reference,
      posteTravauxId: m.posteTravauxId!,
      posteType: m.posteTravaux?.type ?? null,
      prixConvenuCts: m.prixConvenuCts,
      factureExistante: facture ? { id: facture.id, numero: facture.numero, statutAffiche: deriveFactureStatutAffiche(facture, facture.mouvementFinancier) } : null,
    };
  });
}

export type FactureSousTraitantRow = {
  id: string;
  numero: string;
  dossierReference: string;
  montantTTCCts: number;
  dateEmission: Date;
  statutAffiche: FactureStatutAffiche;
  validatedAt: Date | null;
};

export async function getFacturesForSousTraitant(ctx: UserContext): Promise<FactureSousTraitantRow[]> {
  const sousTraitantId = requireSousTraitant(ctx);
  const factures = await prisma.facture.findMany({
    where: { organisationId: ctx.organisationId, type: "SOUS_TRAITANT", sousTraitantId },
    include: { dossier: { select: { reference: true } }, mouvementFinancier: { select: { statut: true } } },
    orderBy: { createdAt: "desc" },
  });
  return factures.map((f) => ({
    id: f.id,
    numero: f.numero,
    dossierReference: f.dossier.reference,
    montantTTCCts: f.montantTTCCts,
    dateEmission: f.dateEmission,
    statutAffiche: deriveFactureStatutAffiche(f, f.mouvementFinancier),
    validatedAt: f.validatedAt,
  }));
}

// --- File de validation interne (factures ST déposées, non validées) --------

export type FactureAValiderRow = {
  id: string;
  numero: string;
  sousTraitantNom: string;
  dossierReference: string;
  dossierId: string;
  montantTTCCts: number;
  dateEmission: Date;
  fichierPdfPath: string | null;
};

export async function getFacturesSousTraitantAValider(organisationId: string): Promise<FactureAValiderRow[]> {
  const factures = await prisma.facture.findMany({
    where: { organisationId, type: "SOUS_TRAITANT", statut: { not: "ANNULEE" }, validatedAt: null },
    include: { sousTraitant: { select: { nom: true } }, dossier: { select: { reference: true } } },
    orderBy: { createdAt: "asc" },
  });
  return factures.map((f) => ({
    id: f.id,
    numero: f.numero,
    sousTraitantNom: f.sousTraitant?.nom ?? "—",
    dossierReference: f.dossier.reference,
    dossierId: f.dossierId,
    montantTTCCts: f.montantTTCCts,
    dateEmission: f.dateEmission,
    fichierPdfPath: f.fichierPdfPath,
  }));
}
