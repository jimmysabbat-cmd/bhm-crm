import { prisma } from "@/lib/prisma";
import { typeTravauxLabels } from "@/lib/dossier-labels";

// ============================================================
// Pilotage des poses : une ligne par poste de travaux engagé, rangée dans
// l'étape où elle se trouve réellement, pour les deux circuits :
//  - "pour un donneur d'ordre" (on pose pour un partenaire, on le facture)
//  - "nos dossiers" (on pose nous-mêmes ou on confie à un sous-traitant).
// Aucune donnée dupliquée : tout est dérivé des missions (TransmissionPackage)
// et des factures existantes.
// ============================================================

export type EtapePose = "A_AFFECTER" | "ATTENTE_REPONSE" | "A_PLANIFIER" | "PLANIFIEE" | "EN_COURS" | "A_FACTURER" | "FACTURE_ST_ATTENDUE" | "A_PAYER";

export const etapePoseLabels: Record<EtapePose, string> = {
  A_AFFECTER: "À affecter (équipe ou sous-traitant)",
  ATTENTE_REPONSE: "En attente de réponse du sous-traitant",
  A_PLANIFIER: "À planifier",
  PLANIFIEE: "Planifiée",
  EN_COURS: "En cours",
  A_FACTURER: "Terminée - à facturer au donneur d'ordre",
  FACTURE_ST_ATTENDUE: "Terminée - facture sous-traitant attendue",
  A_PAYER: "Facture sous-traitant à payer",
};

export type LignePose = {
  posteId: string;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  ville: string | null;
  prestation: string;
  surfaceM2: number | null;
  donneurOrdre: string | null;
  poseur: string | null;
  circuit: "REGIE" | "SOUS_TRAITANT" | null;
  etape: EtapePose;
  dateDebut: Date | null;
  dateFin: Date | null;
  missionStatut: string | null;
};

const STATUTS_ENGAGES = ["DEVIS_SIGNE", "AUDIT_FAIT", "DOSSIER_DEPOSE", "EN_INSTRUCTION", "ACCEPTE", "TRAVAUX_PLANIFIES", "TRAVAUX_EN_COURS", "TRAVAUX_TERMINES", "CONTROLE_EN_COURS", "SOLDE_DEMANDE", "SOLDE_RECU"];
const MISSION_ACTIVES = ["ENVOYEE", "ACCEPTEE", "PLANIFIEE", "EN_COURS", "TERMINEE"];

export async function getPilotagePoses(organisationId: string): Promise<LignePose[]> {
  const postes = await prisma.dossierPosteTravaux.findMany({
    where: { dossier: { organisationId, statut: { key: { in: STATUTS_ENGAGES } } } },
    select: {
      id: true,
      type: true,
      surfaceM2: true,
      dossier: {
        select: {
          id: true,
          reference: true,
          donneurOrdreId: true,
          donneurOrdre: { select: { nom: true } },
          client: { select: { prenom: true, nom: true, ville: true } },
          factures: { where: { statut: { notIn: ["ANNULEE", "REFUSEE"] } }, select: { type: true, statut: true, sousTraitantId: true, lignes: { select: { posteTravauxId: true } } } },
        },
      },
      missions: {
        where: { status: { in: MISSION_ACTIVES as never } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          dateDebutSouhaitee: true,
          dateFinSouhaitee: true,
          destinationSousTraitantId: true,
          destinationSousTraitant: { select: { nom: true } },
          destinationRegie: { select: { nom: true } },
        },
      },
    },
  });

  return postes.map((p): LignePose | null => {
    const d = p.dossier;
    const m = p.missions[0];
    const factureDo = d.factures.find((f) => f.type === "DONNEUR_ORDRE" && f.lignes.some((l) => l.posteTravauxId === p.id));
    const factureSt = m?.destinationSousTraitantId ? d.factures.find((f) => f.type === "SOUS_TRAITANT" && f.sousTraitantId === m.destinationSousTraitantId) : undefined;

    let etape: EtapePose;
    if (!m) etape = "A_AFFECTER";
    else if (m.status === "ENVOYEE" && m.destinationSousTraitantId) etape = "ATTENTE_REPONSE";
    else if ((m.status === "ENVOYEE" || m.status === "ACCEPTEE") && !m.dateDebutSouhaitee) etape = "A_PLANIFIER";
    else if (m.status === "ENVOYEE" || m.status === "ACCEPTEE" || m.status === "PLANIFIEE") etape = "PLANIFIEE";
    else if (m.status === "EN_COURS") etape = "EN_COURS";
    else if (d.donneurOrdreId && !factureDo) etape = "A_FACTURER";
    else if (m.destinationSousTraitantId && !factureSt) etape = "FACTURE_ST_ATTENDUE";
    else if (factureSt && !["PAYEE"].includes(factureSt.statut)) etape = "A_PAYER";
    else return null;

    return {
      posteId: p.id,
      dossierId: d.id,
      dossierReference: d.reference,
      clientLabel: `${d.client.prenom} ${d.client.nom}`,
      ville: d.client.ville,
      prestation: typeTravauxLabels[p.type] ?? p.type,
      surfaceM2: p.surfaceM2,
      donneurOrdre: d.donneurOrdre?.nom ?? null,
      poseur: m?.destinationRegie?.nom ?? m?.destinationSousTraitant?.nom ?? null,
      circuit: m ? (m.destinationSousTraitantId ? "SOUS_TRAITANT" : "REGIE") : null,
      etape,
      dateDebut: m?.dateDebutSouhaitee ?? null,
      dateFin: m?.dateFinSouhaitee ?? null,
      missionStatut: m?.status ?? null,
    };
  }).filter((l): l is LignePose => l !== null);
}
