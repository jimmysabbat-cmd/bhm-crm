import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import type { StatutFacture, TypeFacture } from "@/generated/prisma/enums";

// ============================================================
// P16 - couche d'accès facturation (CLIENT/DONNEUR_ORDRE/SOUS_TRAITANT).
//
// Principe directeur : Facture.statut est désormais la source directe
// (BROUILLON/A_TRANSMETTRE/TRANSMISE/RECUE/A_CONTROLER/VALIDEE/A_PAYER/
// PARTIELLEMENT_PAYEE/PAYEE/REFUSEE/ANNULEE/LITIGE) - PARTIELLEMENT_PAYEE/
// PAYEE ne sont JAMAIS resaisis manuellement, ils sont recalculés à chaque
// règlement (cf. recomputeFactureStatutAndMouvement dans mutations.ts)
// depuis la somme des ReglementFacture, elle-même reflétée dans l'UNIQUE
// MouvementFinancier lié (P6). deriveFactureStatutAffiche() n'ajoute qu'une
// seule chose en lecture : EN_RETARD si l'échéance est dépassée et rien
// n'est encore soldé - jamais stocké, jamais un second état persistant.
// ============================================================

export type FactureStatutAffiche = StatutFacture;

const STATUTS_EN_ATTENTE_PAIEMENT = new Set<StatutFacture>(["TRANSMISE", "A_PAYER", "PARTIELLEMENT_PAYEE"]);

export function deriveFactureStatutAffiche(facture: { statut: StatutFacture; dateEcheance: Date | null }): FactureStatutAffiche {
  if (STATUTS_EN_ATTENTE_PAIEMENT.has(facture.statut) && facture.dateEcheance && facture.dateEcheance.getTime() < Date.now()) {
    return "EN_RETARD";
  }
  return facture.statut;
}

function requireSousTraitant(ctx: UserContext): string {
  if (ctx.role !== "SOUS_TRAITANT" || !ctx.sousTraitantId) throw new Error("Accès réservé aux sous-traitants.");
  return ctx.sousTraitantId;
}

// --- Facture DONNEUR_ORDRE (génération auto, chemin avancé conservé) --------

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
    dejaFacture: p.factureLignes.some((l) => l.facture.statut !== "ANNULEE" && l.facture.statut !== "REFUSEE"),
  }));
}

// --- Listes de factures (interne, cockpit dossier) --------------------------

export type ReglementRow = {
  id: string;
  montantCts: number;
  date: Date;
  mode: string;
  reference: string | null;
  commentaire: string | null;
  createdByName: string | null;
};

export type FactureDossierRow = {
  id: string;
  type: TypeFacture;
  numero: string;
  destinataireNom: string;
  montantHTCts: number;
  montantTTCCts: number;
  montantRegleCts: number;
  resteCts: number;
  dateEmission: Date;
  dateEcheance: Date | null;
  statutAffiche: FactureStatutAffiche;
  validatedAt: Date | null;
  fichierPdfPath: string | null;
  mouvementFinancierId: string | null;
  reglements: ReglementRow[];
};

export async function getFacturesForDossier(dossierId: string, organisationId: string): Promise<FactureDossierRow[]> {
  const factures = await prisma.facture.findMany({
    where: { dossierId, organisationId },
    include: {
      donneurOrdre: { select: { nom: true } },
      sousTraitant: { select: { nom: true } },
      reglements: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return factures.map((f) => {
    const montantRegleCts = f.reglements.reduce((s, r) => s + r.montantCts, 0);
    return {
      id: f.id,
      type: f.type,
      numero: f.numero,
      destinataireNom: f.donneurOrdre?.nom ?? f.sousTraitant?.nom ?? "Client",
      montantHTCts: f.montantHTCts,
      montantTTCCts: f.montantTTCCts,
      montantRegleCts,
      resteCts: Math.max(f.montantTTCCts - montantRegleCts, 0),
      dateEmission: f.dateEmission,
      dateEcheance: f.dateEcheance,
      statutAffiche: deriveFactureStatutAffiche(f),
      validatedAt: f.validatedAt,
      fichierPdfPath: f.fichierPdfPath,
      mouvementFinancierId: f.mouvementFinancierId,
      reglements: f.reglements.map((r) => ({ id: r.id, montantCts: r.montantCts, date: r.date, mode: r.mode, reference: r.reference, commentaire: r.commentaire, createdByName: r.createdBy?.name ?? null })),
    };
  });
}

// --- Cockpit dossier : synthèse facturation (section 8) ---------------------

export type FacturationSummary = {
  factureCts: number;
  encaisseCts: number;
  resteAEncaisserCts: number;
};

/** Facturé/Encaissé/Reste à encaisser côté revenu (CLIENT + DONNEUR_ORDRE, hors annulées/refusées) - jamais les factures ST (dépense, pas revenu). */
export async function getFacturationSummaryForDossier(dossierId: string, organisationId: string): Promise<FacturationSummary> {
  const factures = await prisma.facture.findMany({
    where: { dossierId, organisationId, type: { in: ["CLIENT", "DONNEUR_ORDRE"] }, statut: { notIn: ["ANNULEE", "REFUSEE"] } },
    include: { reglements: { select: { montantCts: true } } },
  });
  const factureCts = factures.reduce((s, f) => s + f.montantTTCCts, 0);
  const encaisseCts = factures.reduce((s, f) => s + f.reglements.reduce((s2, r) => s2 + r.montantCts, 0), 0);
  return { factureCts, encaisseCts, resteAEncaisserCts: Math.max(factureCts - encaisseCts, 0) };
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

/** Missions TERMINEE de ce sous-traitant, avec indication de la facture déjà déposée le cas échéant (jamais un second dépôt tant que la première n'est pas annulée/refusée). */
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
    select: { id: true, numero: true, statut: true, dateEcheance: true, lignes: { select: { posteTravauxId: true } } },
  });

  return missions.map((m) => {
    const facture = factures.find((f) => f.statut !== "ANNULEE" && f.statut !== "REFUSEE" && f.lignes.some((l) => l.posteTravauxId === m.posteTravauxId));
    return {
      packageId: m.id,
      dossierId: m.dossierId,
      dossierReference: m.dossier.reference,
      posteTravauxId: m.posteTravauxId!,
      posteType: m.posteTravaux?.type ?? null,
      prixConvenuCts: m.prixConvenuCts,
      factureExistante: facture ? { id: facture.id, numero: facture.numero, statutAffiche: deriveFactureStatutAffiche(facture) } : null,
    };
  });
}

export type FactureSousTraitantRow = {
  id: string;
  numero: string;
  dossierReference: string;
  montantTTCCts: number;
  montantRegleCts: number;
  dateEmission: Date;
  statutAffiche: FactureStatutAffiche;
  validatedAt: Date | null;
};

export async function getFacturesForSousTraitant(ctx: UserContext): Promise<FactureSousTraitantRow[]> {
  const sousTraitantId = requireSousTraitant(ctx);
  const factures = await prisma.facture.findMany({
    where: { organisationId: ctx.organisationId, type: "SOUS_TRAITANT", sousTraitantId },
    include: { dossier: { select: { reference: true } }, reglements: { select: { montantCts: true } } },
    orderBy: { createdAt: "desc" },
  });
  return factures.map((f) => ({
    id: f.id,
    numero: f.numero,
    dossierReference: f.dossier.reference,
    montantTTCCts: f.montantTTCCts,
    montantRegleCts: f.reglements.reduce((s, r) => s + r.montantCts, 0),
    dateEmission: f.dateEmission,
    statutAffiche: deriveFactureStatutAffiche(f),
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
    where: { organisationId, type: "SOUS_TRAITANT", statut: { notIn: ["ANNULEE", "REFUSEE"] }, validatedAt: null },
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
