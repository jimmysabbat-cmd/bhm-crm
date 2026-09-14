import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/authz";

// ============================================================
// P16 - Source de données du /planning central : agrège en LECTURE SEULE
// deux modèles canoniques déjà existants, jamais un troisième modèle
// d'événement dupliqué :
//   - Rdv (P9) : RDV téléphoniques/commerciaux (type TELEPHONIQUE/VISITE)
//   - TransmissionPackage avec posteTravauxId non nul (P15/P16) : missions
//     envoyées à un sous-traitant OU une équipe interne (régie), fenêtre
//     dateDebutSouhaitee/dateFinSouhaitee - couvre "chantiers/poses".
// Toujours filtré par organisationId (isolation tenant absolue).
// ============================================================

export type PlanningFilters = {
  commercialId?: string;
  sousTraitantId?: string;
  regieId?: string;
  metier?: string; // TypeTravaux
  statut?: string;
};

export type PlanningEvent = {
  id: string;
  kind: "RDV" | "MISSION";
  date: Date;
  dateFin: Date | null;
  titre: string;
  sousTitre: string;
  statut: string;
  href: string | null;
};

export async function getPlanningEvents(ctx: UserContext, range: { start: Date; end: Date }, filters: PlanningFilters): Promise<PlanningEvent[]> {
  const [rdvs, missions] = await Promise.all([
    prisma.rdv.findMany({
      where: {
        organisationId: ctx.organisationId,
        date: { gte: range.start, lt: range.end },
        ...(filters.commercialId ? { commercialId: filters.commercialId } : {}),
        ...(filters.statut && ["PLANIFIE", "CONFIRME", "REALISE", "ANNULE"].includes(filters.statut) ? { statut: filters.statut as never } : {}),
      },
      select: {
        id: true,
        date: true,
        type: true,
        statut: true,
        adresse: true,
        dossierId: true,
        leadId: true,
        commercial: { select: { name: true } },
        dossier: { select: { reference: true, client: { select: { prenom: true, nom: true } } } },
        lead: { select: { prenom: true, nom: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.transmissionPackage.findMany({
      where: {
        organisationId: ctx.organisationId,
        posteTravauxId: { not: null },
        dateDebutSouhaitee: { gte: range.start, lt: range.end },
        ...(filters.sousTraitantId ? { destinationSousTraitantId: filters.sousTraitantId } : {}),
        ...(filters.regieId ? { destinationRegieId: filters.regieId } : {}),
        ...(filters.statut && ["ENVOYEE", "ACCEPTEE", "REFUSEE", "PLANIFIEE", "EN_COURS", "TERMINEE"].includes(filters.statut) ? { status: filters.statut as never } : {}),
        ...(filters.metier ? { posteTravaux: { type: filters.metier as never } } : {}),
      },
      select: {
        id: true,
        status: true,
        dateDebutSouhaitee: true,
        dateFinSouhaitee: true,
        dossierId: true,
        dossier: { select: { reference: true } },
        posteTravaux: { select: { type: true } },
        destinationSousTraitant: { select: { nom: true } },
        destinationRegie: { select: { nom: true } },
      },
      orderBy: { dateDebutSouhaitee: "asc" },
    }),
  ]);

  const rdvEvents: PlanningEvent[] = rdvs.map((r) => ({
    id: r.id,
    kind: "RDV",
    date: r.date,
    dateFin: null,
    titre: r.type === "TELEPHONIQUE" ? "RDV téléphonique" : r.type === "VISITE" ? "Visite" : "RDV",
    sousTitre: [
      r.dossier ? `${r.dossier.client.prenom} ${r.dossier.client.nom} (${r.dossier.reference})` : r.lead ? `${r.lead.prenom} ${r.lead.nom}` : null,
      r.commercial?.name,
    ]
      .filter(Boolean)
      .join(" · "),
    statut: r.statut,
    href: r.dossierId ? `/dossiers/${r.dossierId}` : r.leadId ? `/leads/${r.leadId}` : null,
  }));

  const missionEvents: PlanningEvent[] = missions.map((m) => ({
    id: m.id,
    kind: "MISSION",
    date: m.dateDebutSouhaitee as Date,
    dateFin: m.dateFinSouhaitee,
    titre: m.posteTravaux?.type ?? "Poste",
    sousTitre: [m.destinationSousTraitant?.nom ?? m.destinationRegie?.nom, m.dossier.reference].filter(Boolean).join(" · "),
    statut: m.status,
    href: `/dossiers/${m.dossierId}`,
  }));

  return [...rdvEvents, ...missionEvents].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function getPlanningFilterOptions(ctx: UserContext) {
  const [commerciaux, sousTraitants, regies] = await Promise.all([
    prisma.user.findMany({
      where: { organisationId: ctx.organisationId, role: { in: ["COMMERCIAL", "TELEPROSPECTEUR"] }, actif: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.sousTraitant.findMany({ where: { organisationId: ctx.organisationId, actif: true }, select: { id: true, nom: true }, orderBy: { nom: "asc" } }),
    prisma.regie.findMany({ where: { organisationId: ctx.organisationId, actif: true }, select: { id: true, nom: true }, orderBy: { nom: "asc" } }),
  ]);
  return { commerciaux, sousTraitants, regies };
}
