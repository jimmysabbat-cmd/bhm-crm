import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";
import { deriveFactureStatutAffiche } from "@/lib/facturation/access";

// ============================================================
// P16 - Portail donneur d'ordre (section 24bis). Un compte DONNEUR_ORDRE
// ne voit QUE ses propres dossiers (Dossier.donneurOrdreId), documents et
// factures - jamais de finance interne (marge, coûts, avis d'imposition),
// jamais un autre donneur d'ordre, jamais les dossiers "organiques"
// (créés en interne, donneurOrdreId nul). Même discipline que
// src/lib/partners/access.ts pour SOUS_TRAITANT/DELEGATAIRE_CEE.
// ============================================================

const STATUTS_A_PROGRAMMER = ["DEVIS_SIGNE", "AUDIT_FAIT", "DOSSIER_DEPOSE", "EN_INSTRUCTION", "ACCEPTE"];
const STATUTS_PROGRAMMES = ["TRAVAUX_PLANIFIES"];
const STATUTS_EN_COURS = ["TRAVAUX_EN_COURS"];
const STATUTS_TERMINES = ["TRAVAUX_TERMINES", "CONTROLE_EN_COURS", "SOLDE_DEMANDE", "SOLDE_RECU", "CLOTURE"];

export type DemandeVue = "toutes" | "a-programmer" | "programmes" | "en-cours" | "termines";

const VUE_STATUTS: Record<Exclude<DemandeVue, "toutes">, string[]> = {
  "a-programmer": STATUTS_A_PROGRAMMER,
  programmes: STATUTS_PROGRAMMES,
  "en-cours": STATUTS_EN_COURS,
  termines: STATUTS_TERMINES,
};

export type DemandeRow = {
  id: string;
  reference: string;
  clientNom: string;
  clientVille: string | null;
  statutLabel: string;
  statutKey: string;
  postes: { type: string; surfaceM2: number | null }[];
  createdAt: Date;
  dateDebutTravaux: Date | null;
  dateFinTravaux: Date | null;
};

function requireDonneurOrdre(ctx: UserContext): string {
  if (ctx.role !== "DONNEUR_ORDRE" || !ctx.donneurOrdreId) throw new Error("Accès refusé.");
  return ctx.donneurOrdreId;
}

export async function getDemandesForDonneurOrdre(ctx: UserContext, vue: DemandeVue): Promise<DemandeRow[]> {
  const donneurOrdreId = requireDonneurOrdre(ctx);
  const dossiers = await prisma.dossier.findMany({
    where: {
      donneurOrdreId,
      organisationId: ctx.organisationId,
      ...(vue === "toutes" ? {} : { statut: { key: { in: VUE_STATUTS[vue] } } }),
    },
    select: {
      id: true,
      reference: true,
      createdAt: true,
      dateDebutTravaux: true,
      dateFinTravaux: true,
      client: { select: { nom: true, prenom: true, ville: true } },
      statut: { select: { key: true, label: true } },
      postesTravaux: { select: { type: true, surfaceM2: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return dossiers.map((d) => ({
    id: d.id,
    reference: d.reference,
    clientNom: `${d.client.prenom} ${d.client.nom}`,
    clientVille: d.client.ville,
    statutLabel: d.statut.label,
    statutKey: d.statut.key,
    postes: d.postesTravaux,
    createdAt: d.createdAt,
    dateDebutTravaux: d.dateDebutTravaux,
    dateFinTravaux: d.dateFinTravaux,
  }));
}

export async function getDemandeDetailForDonneurOrdre(ctx: UserContext, dossierId: string) {
  const donneurOrdreId = requireDonneurOrdre(ctx);
  const dossier = await prisma.dossier.findFirst({
    where: { id: dossierId, donneurOrdreId, organisationId: ctx.organisationId },
    select: {
      id: true,
      reference: true,
      createdAt: true,
      dateDebutTravaux: true,
      dateFinTravaux: true,
      complementDemandeMessage: true,
      complementDemandeAt: true,
      complementReponseMessage: true,
      complementReponseAt: true,
      client: { select: { nom: true, prenom: true, telephone: true, email: true, adresse: true, ville: true, codePostal: true } },
      statut: { select: { label: true } },
      postesTravaux: { select: { id: true, type: true, surfaceM2: true, quantite: true } },
      documents: { where: { statut: { not: "REMPLACE" } }, select: { id: true, nomFichier: true, typeDocumentRef: { select: { nom: true } } } },
    },
  });
  if (!dossier) throw new Error("Demande introuvable.");
  return dossier;
}

export type FactureDoRow = {
  id: string;
  numero: string;
  dossierReference: string;
  montantTTCCts: number;
  resteCts: number;
  dateEmission: Date;
  dateEcheance: Date | null;
  statut: string;
};

export async function getFacturesForDonneurOrdre(ctx: UserContext): Promise<FactureDoRow[]> {
  const donneurOrdreId = requireDonneurOrdre(ctx);
  const factures = await prisma.facture.findMany({
    where: { donneurOrdreId, organisationId: ctx.organisationId, type: "DONNEUR_ORDRE", statut: { notIn: ["BROUILLON", "A_TRANSMETTRE"] } },
    select: {
      id: true,
      numero: true,
      montantTTCCts: true,
      dateEmission: true,
      dateEcheance: true,
      statut: true,
      reglements: { select: { montantCts: true } },
      dossier: { select: { reference: true } },
    },
    orderBy: { dateEmission: "desc" },
  });
  return factures.map((f) => ({
    id: f.id,
    numero: f.numero,
    resteCts: Math.max(f.montantTTCCts - f.reglements.reduce((s, r) => s + r.montantCts, 0), 0),
    dossierReference: f.dossier.reference,
    montantTTCCts: f.montantTTCCts,
    dateEmission: f.dateEmission,
    dateEcheance: f.dateEcheance,
    statut: deriveFactureStatutAffiche(f),
  }));
}

export async function getDashboardCountsForDonneurOrdre(ctx: UserContext) {
  const donneurOrdreId = requireDonneurOrdre(ctx);
  const [total, aProgrammer, programmes, enCours, termines] = await Promise.all([
    prisma.dossier.count({ where: { donneurOrdreId, organisationId: ctx.organisationId } }),
    prisma.dossier.count({ where: { donneurOrdreId, organisationId: ctx.organisationId, statut: { key: { in: STATUTS_A_PROGRAMMER } } } }),
    prisma.dossier.count({ where: { donneurOrdreId, organisationId: ctx.organisationId, statut: { key: { in: STATUTS_PROGRAMMES } } } }),
    prisma.dossier.count({ where: { donneurOrdreId, organisationId: ctx.organisationId, statut: { key: { in: STATUTS_EN_COURS } } } }),
    prisma.dossier.count({ where: { donneurOrdreId, organisationId: ctx.organisationId, statut: { key: { in: STATUTS_TERMINES } } } }),
  ]);
  return { total, aProgrammer, programmes, enCours, termines };
}

// ============================================================
// "Envoyer un chantier" - alimente DIRECTEMENT les objets canoniques
// (Client + Dossier + DossierPosteTravaux), jamais une table "Demande"
// parallèle. Même statut de départ que la conversion lead->dossier
// (PROSPECT_ETUDE) pour rester dans le même pipeline RECEVOIR->QUALIFIER
// que le reste du CRM - un dossier envoyé par un DO n'est pas un objet
// différent, seulement un dossier avec donneurOrdreId renseigné.
// ============================================================
export async function createDemandeFromDonneurOrdre(
  ctx: UserContext,
  input: {
    referenceDonneurOrdre: string | null;
    clientNom: string;
    clientPrenom: string;
    clientTelephone: string | null;
    clientEmail: string | null;
    clientAdresse: string | null;
    clientCodePostal: string | null;
    clientVille: string | null;
    typeTravaux: string;
    surfaceM2: number | null;
    quantite: number | null;
    infosTechniques: string | null;
    dateSouhaitee: Date | null;
  }
): Promise<{ dossierId: string }> {
  const donneurOrdreId = requireDonneurOrdre(ctx);

  const client = await prisma.client.create({
    data: {
      organisationId: ctx.organisationId,
      prenom: input.clientPrenom,
      nom: input.clientNom,
      telephone: input.clientTelephone,
      email: input.clientEmail,
      adresse: input.clientAdresse,
      codePostal: input.clientCodePostal,
      ville: input.clientVille,
    },
  });

  const [type, statut] = await Promise.all([
    prisma.dossierType.findUniqueOrThrow({ where: { key: "MONOGESTE" } }),
    prisma.dossierStatus.findUniqueOrThrow({ where: { key: "PROSPECT_ETUDE" } }),
  ]);

  const dossier = await prisma.dossier.create({
    data: {
      reference: `DO-${Date.now().toString(36).toUpperCase()}`,
      clientId: client.id,
      organisationId: ctx.organisationId,
      typeId: type.id,
      statutId: statut.id,
      montantDevisTTC: 0,
      donneurOrdreId,
      dateDebutTravaux: input.dateSouhaitee,
      postesTravaux: {
        create: {
          type: input.typeTravaux as never,
          surfaceM2: input.surfaceM2,
          quantite: input.quantite,
        },
      },
    },
    select: { id: true },
  });

  // Les infos techniques/commentaires libres du donneur d'ordre n'ont pas
  // de champ structuré dédié sur Dossier/DossierPosteTravaux - une tâche
  // "à qualifier" les rend visibles à l'équipe interne sans champ parallèle,
  // et amorce naturellement l'étape QUALIFIER du pipeline.
  const details = [input.referenceDonneurOrdre ? `Réf. donneur d'ordre : ${input.referenceDonneurOrdre}` : null, input.infosTechniques].filter(Boolean).join("\n");
  await prisma.tache.create({
    data: {
      dossierId: dossier.id,
      type: "AUTRE",
      titre: "Nouvelle demande donneur d'ordre à qualifier",
      description: details || null,
      dateEcheance: new Date(),
    },
  });

  return { dossierId: dossier.id };
}
