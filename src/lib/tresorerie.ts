import { prisma } from "@/lib/prisma";
import { mouvementIsLate, mouvementJoursRetard } from "@/lib/finance";
import { categorieMouvementLabels, statutMouvementLabels, resteAChargeCents } from "@/lib/dossier-labels";
import { fluxDe, getRemainingAmount, isSettled } from "@/lib/financial-engine";
import type { CategorieMouvementFinancier, PartiePrenante, TypeMouvementFinancier } from "@/generated/prisma/enums";

// ============================================================
// Pilotage de trésorerie : UN échéancier unique de tout ce qui doit
// rentrer et sortir, par contrepartie (ANAH, délégataire CEE X, donneur
// d'ordre Y, client, sous-traitant Z, fournisseur...) et par échéance.
//
// Sources, sans jamais compter deux fois le même flux :
// - les MouvementFinancier détaillés (source de vérité dès qu'ils existent) ;
// - des lignes VIRTUELLES reconstituées en lecture seule quand rien de
//   détaillé n'existe encore pour ce dossier + cette catégorie :
//     · entrées : agrégats Dossier (aide MPR, prime CEE, reste à charge
//       client) - même règle que getEntreeLignesForDossier ;
//     · sorties : coûts des postes de travaux (sous-traitance, régie,
//       matériel), jusqu'ici absents de « à payer ».
// Pointer un paiement sur une ligne virtuelle la MATÉRIALISE d'abord en
// mouvement (avec toutes ses sœurs du même dossier + catégorie), puis
// applique le paiement : l'historique devient daté à partir de là.
// ============================================================

export type SensTreso = "ENTREE" | "SORTIE";
export type ContrepartieType = "ANAH" | "CEE" | "CLIENT" | "DONNEUR_ORDRE" | "SOUS_TRAITANT" | "REGIE" | "FOURNISSEUR" | "AUTRE";

export const contrepartieTypeLabels: Record<ContrepartieType, string> = {
  ANAH: "ANAH (MaPrimeRénov')",
  CEE: "Délégataire CEE",
  CLIENT: "Client",
  DONNEUR_ORDRE: "Donneur d'ordre",
  SOUS_TRAITANT: "Sous-traitant",
  REGIE: "Régie",
  FOURNISSEUR: "Fournisseur",
  AUTRE: "Autre",
};

export type LigneTreso = {
  id: string; // id du mouvement, ou "v|dossierId|categorie|posteId" pour une ligne virtuelle
  sens: SensTreso;
  virtuelle: boolean;
  factureId: string | null;
  dossierId: string;
  dossierReference: string;
  clientLabel: string;
  categorie: CategorieMouvementFinancier;
  categorieLabel: string;
  cpType: ContrepartieType;
  cpNom: string;
  cpKey: string;
  prevuCts: number;
  reelCts: number;
  resteCts: number;
  echeance: Date | null;
  echeanceEstimee: boolean;
  enRetard: boolean;
  joursRetard: number;
  statutLabel: string;
};

const CATEGORIES_SORTIE_POSTES: CategorieMouvementFinancier[] = ["PAIEMENT_SOUS_TRAITANT", "POSE_INTERNE", "PAIEMENT_FOURNISSEUR"];
// Dossiers dont les coûts/aides ne sont pas encore engagés.
const STATUTS_NON_ENGAGES = new Set(["PROSPECT_ETUDE", "REFUSE"]);

function addDays(d: Date, jours: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + jours);
  return r;
}

function cpTypeFromPartie(p: PartiePrenante | null, sens: SensTreso, categorie: CategorieMouvementFinancier): ContrepartieType {
  switch (p) {
    case "ANAH":
      return "ANAH";
    case "CEE":
      return "CEE";
    case "CLIENT":
      return "CLIENT";
    case "DONNEUR_ORDRE":
      return "DONNEUR_ORDRE";
    case "SOUS_TRAITANT":
      return "SOUS_TRAITANT";
    case "REGIE":
      return "REGIE";
    case "FOURNISSEUR":
      return "FOURNISSEUR";
  }
  // Pas de type renseigné : déduit de la catégorie.
  if (sens === "ENTREE") {
    const flux = fluxDe(categorie);
    if (flux === "MPR") return "ANAH";
    if (flux === "CEE") return "CEE";
    if (flux === "CLIENT" || categorie === "REMBOURSEMENT_AVANCE_CLIENT") return "CLIENT";
    if (categorie === "ENCAISSEMENT_DONNEUR_ORDRE") return "DONNEUR_ORDRE";
    return "AUTRE";
  }
  if (categorie === "PAIEMENT_SOUS_TRAITANT") return "SOUS_TRAITANT";
  if (categorie === "POSE_INTERNE" || categorie === "COMMISSION_REGIE") return "REGIE";
  if (categorie === "PAIEMENT_FOURNISSEUR" || categorie === "LOCATION_MATERIEL" || categorie === "ECHAFAUDAGE") return "FOURNISSEUR";
  return "AUTRE";
}

function cpKeyOf(type: ContrepartieType, nom: string): string {
  return `${type}:${nom.trim().toLowerCase()}`;
}

const DOSSIER_SELECT = {
  id: true,
  reference: true,
  donneurOrdreId: true,
  montantDevisTTC: true,
  montantAideMPR: true,
  montantAideCEE: true,
  montantEncaisseClient: true,
  montantEncaisseMPR: true,
  montantEncaisseCEE: true,
  dateDepotDelegataireCee: true,
  dateDebutTravaux: true,
  dateFinTravaux: true,
  statut: { select: { key: true } },
  client: { select: { prenom: true, nom: true } },
  delegataireCee: { select: { nom: true, delaiPaiementJours: true } },
  donneurOrdre: { select: { nom: true } },
  postesTravaux: {
    select: {
      id: true,
      montantPoseSousTraitanceCts: true,
      montantRegieCts: true,
      montantMaterielHTCts: true,
      montantMaterielTTCCts: true,
      sousTraitant: { select: { nom: true, delaiPaiementJours: true } },
      regie: { select: { nom: true } },
    },
  },
} as const;

type MouvementCharge = {
  id: string;
  dossierId: string;
  type: TypeMouvementFinancier;
  categorie: CategorieMouvementFinancier;
  payeur: string | null;
  beneficiaire: string | null;
  payeurType: PartiePrenante | null;
  beneficiaireType: PartiePrenante | null;
  montantPrevuCts: number | null;
  montantReelCts: number | null;
  datePrevue: Date | null;
  statut: import("@/generated/prisma/enums").StatutMouvementFinancier;
  facture: { id: string } | null;
};

type DossierCharge = Awaited<ReturnType<typeof loadDossiers>>[number];

async function loadDossiers(organisationId: string, dossierId?: string) {
  return prisma.dossier.findMany({
    where: { organisationId, statut: { key: { not: "CLOTURE" } }, ...(dossierId ? { id: dossierId } : {}) },
    select: DOSSIER_SELECT,
  });
}

async function loadMouvements(organisationId: string, dossierIds: string[]): Promise<MouvementCharge[]> {
  return prisma.mouvementFinancier.findMany({
    where: { organisationId, dossierId: { in: dossierIds }, statut: { not: "ANNULE" } },
    select: {
      id: true,
      dossierId: true,
      type: true,
      categorie: true,
      payeur: true,
      beneficiaire: true,
      payeurType: true,
      beneficiaireType: true,
      montantPrevuCts: true,
      montantReelCts: true,
      datePrevue: true,
      statut: true,
      facture: { select: { id: true } },
    },
  });
}

function nomParDefaut(type: ContrepartieType, d: DossierCharge): string {
  const clientLabel = `${d.client.prenom} ${d.client.nom}`;
  switch (type) {
    case "ANAH":
      return "ANAH";
    case "CEE":
      return d.delegataireCee?.nom ?? "Délégataire CEE non renseigné";
    case "CLIENT":
      return clientLabel;
    case "DONNEUR_ORDRE":
      return d.donneurOrdre?.nom ?? "Donneur d'ordre";
    default:
      return contrepartieTypeLabels[type];
  }
}

/** Lignes virtuelles (entrées legacy + sorties issues des postes) d'un dossier, compte tenu de ses mouvements existants. */
function lignesVirtuelles(d: DossierCharge, mouvements: MouvementCharge[]): LigneTreso[] {
  const out: LigneTreso[] = [];
  const clientLabel = `${d.client.prenom} ${d.client.nom}`;
  const statutKey = d.statut.key;
  const categoriesPresentes = new Set(mouvements.map((m) => m.categorie));
  const fluxPresents = new Set(mouvements.filter((m) => m.type === "ENTREE").map((m) => fluxDe(m.categorie)));
  const aFactureDo = mouvements.some((m) => m.categorie === "ENCAISSEMENT_DONNEUR_ORDRE");

  const push = (p: {
    sens: SensTreso;
    categorie: CategorieMouvementFinancier;
    posteId?: string;
    cpType: ContrepartieType;
    cpNom: string;
    prevuCts: number;
    reelCts: number;
    echeance: Date | null;
  }) => {
    const resteCts = Math.max(p.prevuCts - p.reelCts, 0);
    if (resteCts <= 0) return;
    const enRetard = p.echeance != null && p.echeance.getTime() < Date.now();
    out.push({
      id: ["v", d.id, p.categorie, p.posteId ?? ""].join("|"),
      sens: p.sens,
      virtuelle: true,
      factureId: null,
      dossierId: d.id,
      dossierReference: d.reference,
      clientLabel,
      categorie: p.categorie,
      categorieLabel: categorieMouvementLabels[p.categorie],
      cpType: p.cpType,
      cpNom: p.cpNom,
      cpKey: cpKeyOf(p.cpType, p.cpNom),
      prevuCts: p.prevuCts,
      reelCts: p.reelCts,
      resteCts,
      echeance: p.echeance,
      echeanceEstimee: true,
      enRetard,
      joursRetard: enRetard && p.echeance ? Math.floor((Date.now() - p.echeance.getTime()) / 86_400_000) : 0,
      statutLabel: p.sens === "ENTREE" ? "À recevoir (estimé)" : "À payer (estimé)",
    });
  };

  if (statutKey === "REFUSE") return out;

  // --- Entrées (même règle anti double-comptage que financial-engine) ---
  if (!fluxPresents.has("CEE") && d.montantAideCEE > 0) {
    const echeance = d.dateDepotDelegataireCee && d.delegataireCee?.delaiPaiementJours != null ? addDays(d.dateDepotDelegataireCee, d.delegataireCee.delaiPaiementJours) : null;
    push({ sens: "ENTREE", categorie: "ENCAISSEMENT_CEE", cpType: "CEE", cpNom: nomParDefaut("CEE", d), prevuCts: d.montantAideCEE, reelCts: d.montantEncaisseCEE, echeance });
  }
  if (!fluxPresents.has("MPR") && d.montantAideMPR > 0) {
    push({ sens: "ENTREE", categorie: "ENCAISSEMENT_MPR", cpType: "ANAH", cpNom: "ANAH", prevuCts: d.montantAideMPR, reelCts: d.montantEncaisseMPR, echeance: null });
  }
  if (!fluxPresents.has("CLIENT") && !(d.donneurOrdreId && aFactureDo)) {
    const prevu = resteAChargeCents(d);
    if (prevu > 0) {
      push({ sens: "ENTREE", categorie: "CLIENT_SOLDE", cpType: "CLIENT", cpNom: clientLabel, prevuCts: prevu, reelCts: d.montantEncaisseClient, echeance: d.dateFinTravaux });
    }
  }

  // --- Sorties issues des postes (uniquement dossiers engagés) ---
  if (STATUTS_NON_ENGAGES.has(statutKey)) return out;
  for (const p of d.postesTravaux) {
    if (!categoriesPresentes.has("PAIEMENT_SOUS_TRAITANT") && (p.montantPoseSousTraitanceCts ?? 0) > 0) {
      const delai = p.sousTraitant?.delaiPaiementJours;
      push({
        sens: "SORTIE",
        categorie: "PAIEMENT_SOUS_TRAITANT",
        posteId: p.id,
        cpType: "SOUS_TRAITANT",
        cpNom: p.sousTraitant?.nom ?? "Sous-traitant non renseigné",
        prevuCts: p.montantPoseSousTraitanceCts ?? 0,
        reelCts: 0,
        echeance: d.dateFinTravaux ? addDays(d.dateFinTravaux, delai ?? 0) : null,
      });
    }
    if (!categoriesPresentes.has("POSE_INTERNE") && (p.montantRegieCts ?? 0) > 0) {
      push({
        sens: "SORTIE",
        categorie: "POSE_INTERNE",
        posteId: p.id,
        cpType: "REGIE",
        cpNom: p.regie?.nom ?? "Régie",
        prevuCts: p.montantRegieCts ?? 0,
        reelCts: 0,
        echeance: d.dateFinTravaux,
      });
    }
    const materiel = p.montantMaterielTTCCts ?? p.montantMaterielHTCts ?? 0;
    if (!categoriesPresentes.has("PAIEMENT_FOURNISSEUR") && materiel > 0) {
      push({
        sens: "SORTIE",
        categorie: "PAIEMENT_FOURNISSEUR",
        posteId: p.id,
        cpType: "FOURNISSEUR",
        cpNom: "Fournisseur matériel",
        prevuCts: materiel,
        reelCts: 0,
        echeance: d.dateDebutTravaux,
      });
    }
  }
  return out;
}

function ligneDeMouvement(m: MouvementCharge, d: DossierCharge): LigneTreso {
  const sens: SensTreso = m.type === "ENTREE" ? "ENTREE" : "SORTIE";
  const cpType = cpTypeFromPartie(sens === "ENTREE" ? m.payeurType : m.beneficiaireType, sens, m.categorie);
  const nomLibre = (sens === "ENTREE" ? m.payeur : m.beneficiaire)?.trim();
  // Un libellé générique ("Client", "ANAH", "CEE"...) est remplacé par le nom réel connu sur le dossier.
  const generique = !nomLibre || ["client", "anah", "cee", "délégataire cee", "delegataire cee", "sous-traitant", "fournisseur"].includes(nomLibre.toLowerCase());
  const cpNom = generique ? nomParDefaut(cpType, d) : nomLibre!;
  return {
    id: m.id,
    sens,
    virtuelle: false,
    factureId: m.facture?.id ?? null,
    dossierId: d.id,
    dossierReference: d.reference,
    clientLabel: `${d.client.prenom} ${d.client.nom}`,
    categorie: m.categorie,
    categorieLabel: categorieMouvementLabels[m.categorie],
    cpType,
    cpNom,
    cpKey: cpKeyOf(cpType, cpNom),
    prevuCts: m.montantPrevuCts ?? 0,
    reelCts: m.montantReelCts ?? 0,
    resteCts: getRemainingAmount(m),
    echeance: m.datePrevue,
    echeanceEstimee: false,
    enRetard: mouvementIsLate(m),
    joursRetard: mouvementJoursRetard(m),
    statutLabel: statutMouvementLabels[m.statut] ?? m.statut,
  };
}

/** Toutes les lignes NON soldées (entrées et sorties) de l'organisation. 2 requêtes, quel que soit le nombre de dossiers. */
export async function getLignesTresorerie(organisationId: string, dossierId?: string): Promise<LigneTreso[]> {
  const dossiers = await loadDossiers(organisationId, dossierId);
  const mouvements = await loadMouvements(
    organisationId,
    dossiers.map((d) => d.id)
  );
  const parDossier = new Map<string, MouvementCharge[]>();
  for (const m of mouvements) {
    const arr = parDossier.get(m.dossierId) ?? [];
    arr.push(m);
    parDossier.set(m.dossierId, arr);
  }
  const lignes: LigneTreso[] = [];
  for (const d of dossiers) {
    const ms = parDossier.get(d.id) ?? [];
    for (const m of ms) {
      if (isSettled(m) || getRemainingAmount(m) <= 0) continue;
      lignes.push(ligneDeMouvement(m, d));
    }
    lignes.push(...lignesVirtuelles(d, ms));
  }
  return lignes;
}

// --- Agrégations -----------------------------------------------------------

export type SyntheseContrepartie = {
  cpKey: string;
  cpType: ContrepartieType;
  cpNom: string;
  sens: SensTreso;
  resteCts: number;
  enRetardCts: number;
  sous30jCts: number;
  plusTardCts: number;
  sansDateCts: number;
  nbLignes: number;
  nbDossiers: number;
  prochaineEcheance: Date | null;
};

export function syntheseParContrepartie(lignes: LigneTreso[]): SyntheseContrepartie[] {
  const map = new Map<string, SyntheseContrepartie & { dossiers: Set<string> }>();
  const dans30j = Date.now() + 30 * 86_400_000;
  for (const l of lignes) {
    const key = `${l.sens}|${l.cpKey}`;
    const s =
      map.get(key) ??
      { cpKey: l.cpKey, cpType: l.cpType, cpNom: l.cpNom, sens: l.sens, resteCts: 0, enRetardCts: 0, sous30jCts: 0, plusTardCts: 0, sansDateCts: 0, nbLignes: 0, nbDossiers: 0, prochaineEcheance: null, dossiers: new Set<string>() };
    s.resteCts += l.resteCts;
    s.nbLignes += 1;
    s.dossiers.add(l.dossierId);
    if (!l.echeance) s.sansDateCts += l.resteCts;
    else if (l.enRetard) s.enRetardCts += l.resteCts;
    else if (l.echeance.getTime() <= dans30j) s.sous30jCts += l.resteCts;
    else s.plusTardCts += l.resteCts;
    if (l.echeance && !l.enRetard && (!s.prochaineEcheance || l.echeance < s.prochaineEcheance)) s.prochaineEcheance = l.echeance;
    map.set(key, s);
  }
  return Array.from(map.values())
    .map(({ dossiers, ...s }) => ({ ...s, nbDossiers: dossiers.size }))
    .sort((a, b) => b.resteCts - a.resteCts);
}

export type ColonneEcheancier = { key: string; label: string; entreesCts: number; sortiesCts: number; netCts: number; cumulCts: number };

/** Échéancier mensuel : En retard | mois courant | M+1..M+(nbMois-1) | Plus tard | Sans date. */
export function echeancierMensuel(lignes: LigneTreso[], nbMois = 6): ColonneEcheancier[] {
  const now = new Date();
  const cols: ColonneEcheancier[] = [{ key: "retard", label: "En retard", entreesCts: 0, sortiesCts: 0, netCts: 0, cumulCts: 0 }];
  for (let i = 0; i < nbMois; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    cols.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), entreesCts: 0, sortiesCts: 0, netCts: 0, cumulCts: 0 });
  }
  cols.push({ key: "plus-tard", label: "Plus tard", entreesCts: 0, sortiesCts: 0, netCts: 0, cumulCts: 0 });
  cols.push({ key: "sans-date", label: "Sans date", entreesCts: 0, sortiesCts: 0, netCts: 0, cumulCts: 0 });
  const byKey = new Map(cols.map((c) => [c.key, c]));

  for (const l of lignes) {
    let key: string;
    if (!l.echeance) key = "sans-date";
    else if (l.enRetard) key = "retard";
    else {
      key = `${l.echeance.getFullYear()}-${l.echeance.getMonth()}`;
      if (!byKey.has(key)) key = "plus-tard";
    }
    const c = byKey.get(key)!;
    if (l.sens === "ENTREE") c.entreesCts += l.resteCts;
    else c.sortiesCts += l.resteCts;
  }
  let cumul = 0;
  for (const c of cols) {
    c.netCts = c.entreesCts - c.sortiesCts;
    if (c.key !== "sans-date") {
      cumul += c.netCts;
      c.cumulCts = cumul;
    }
  }
  return cols;
}

export type MoisRealise = { key: string; label: string; encaisseCts: number; decaisseCts: number };

/**
 * Réalisé (argent réellement reçu / versé) par mois, sur les `nbMois`
 * derniers mois. Sources : règlements pointés (ReglementMouvement),
 * règlements de factures (ReglementFacture), et mouvements soldés à la
 * main avec une date réelle mais sans détail de règlement.
 */
export async function getRealiseParMois(organisationId: string, nbMois = 6): Promise<MoisRealise[]> {
  const now = new Date();
  const debut = new Date(now.getFullYear(), now.getMonth() - (nbMois - 1), 1);
  const mois: MoisRealise[] = [];
  for (let i = 0; i < nbMois; i++) {
    const d = new Date(debut.getFullYear(), debut.getMonth() + i, 1);
    mois.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), encaisseCts: 0, decaisseCts: 0 });
  }
  const byKey = new Map(mois.map((m) => [m.key, m]));
  const add = (date: Date, sens: SensTreso, cts: number) => {
    const m = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (!m) return;
    if (sens === "ENTREE") m.encaisseCts += cts;
    else m.decaisseCts += cts;
  };

  const [regMvt, regFact, soldesManuels] = await Promise.all([
    prisma.reglementMouvement.findMany({ where: { organisationId, date: { gte: debut } }, select: { date: true, montantCts: true, mouvement: { select: { type: true } } } }),
    prisma.reglementFacture.findMany({ where: { date: { gte: debut }, facture: { organisationId } }, select: { date: true, montantCts: true, facture: { select: { type: true } } } }),
    prisma.mouvementFinancier.findMany({
      where: { organisationId, dateReelle: { gte: debut }, statut: { not: "ANNULE" }, montantReelCts: { gt: 0 }, facture: null, reglements: { none: {} } },
      select: { dateReelle: true, montantReelCts: true, type: true },
    }),
  ]);
  for (const r of regMvt) add(r.date, r.mouvement.type === "ENTREE" ? "ENTREE" : "SORTIE", r.montantCts);
  for (const r of regFact) add(r.date, r.facture.type === "SOUS_TRAITANT" ? "SORTIE" : "ENTREE", r.montantCts);
  for (const m of soldesManuels) if (m.dateReelle) add(m.dateReelle, m.type === "ENTREE" ? "ENTREE" : "SORTIE", m.montantReelCts ?? 0);
  return mois;
}

export type ReglementRecent = {
  id: string;
  date: Date;
  montantCts: number;
  sens: SensTreso;
  reference: string | null;
  mode: string;
  dossierId: string;
  dossierReference: string;
  categorieLabel: string;
  contrepartie: string | null;
};

export async function getReglementsRecents(organisationId: string, limit = 30): Promise<ReglementRecent[]> {
  const rows = await prisma.reglementMouvement.findMany({
    where: { organisationId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      date: true,
      montantCts: true,
      reference: true,
      mode: true,
      mouvement: { select: { type: true, categorie: true, payeur: true, beneficiaire: true, dossierId: true, dossier: { select: { reference: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    montantCts: r.montantCts,
    sens: r.mouvement.type === "ENTREE" ? "ENTREE" : "SORTIE",
    reference: r.reference,
    mode: r.mode,
    dossierId: r.mouvement.dossierId,
    dossierReference: r.mouvement.dossier.reference,
    categorieLabel: categorieMouvementLabels[r.mouvement.categorie],
    contrepartie: r.mouvement.type === "ENTREE" ? r.mouvement.payeur : r.mouvement.beneficiaire,
  }));
}

// --- Pointage d'un paiement réel --------------------------------------------

const PARTIE_PAR_CP: Record<ContrepartieType, PartiePrenante> = {
  ANAH: "ANAH",
  CEE: "CEE",
  CLIENT: "CLIENT",
  DONNEUR_ORDRE: "DONNEUR_ORDRE",
  SOUS_TRAITANT: "SOUS_TRAITANT",
  REGIE: "REGIE",
  FOURNISSEUR: "FOURNISSEUR",
  AUTRE: "AUTRE",
};

/**
 * Transforme toutes les lignes virtuelles (dossier + catégorie) en vrais
 * mouvements, et renvoie l'id du mouvement correspondant à `ligneId`.
 * Matérialiser toutes les sœurs évite qu'un seul mouvement créé ne fasse
 * disparaître les autres lignes virtuelles de la même catégorie.
 */
async function materialiser(organisationId: string, userId: string, ligneId: string): Promise<string> {
  const [, dossierId, categorie, posteId] = ligneId.split("|");
  const lignes = (await getLignesTresorerie(organisationId, dossierId)).filter((l) => l.virtuelle && l.categorie === categorie);
  const cible = lignes.find((l) => l.id === ligneId);
  if (!cible) throw new Error("Ligne introuvable ou déjà soldée - rechargez la page.");

  let cibleMouvementId = "";
  for (const l of lignes) {
    const partie = PARTIE_PAR_CP[l.cpType];
    const m = await prisma.mouvementFinancier.create({
      data: {
        organisationId,
        dossierId,
        type: l.sens,
        categorie: l.categorie,
        payeur: l.sens === "ENTREE" ? l.cpNom : "Entreprise",
        payeurType: l.sens === "ENTREE" ? partie : "ENTREPRISE",
        beneficiaire: l.sens === "SORTIE" ? l.cpNom : "Entreprise",
        beneficiaireType: l.sens === "SORTIE" ? partie : "ENTREPRISE",
        montantPrevuCts: l.prevuCts,
        montantReelCts: l.reelCts > 0 ? l.reelCts : null,
        datePrevue: l.echeance,
        statut: l.reelCts > 0 ? "PARTIEL" : l.sens === "ENTREE" ? "A_RECEVOIR" : "A_PAYER",
        origine: "TRESORERIE_POINTAGE",
        commentaire: l.reelCts > 0 ? "Montant déjà encaissé repris des agrégats du dossier." : null,
        createdById: userId,
      },
      select: { id: true },
    });
    if (l.id === ligneId) cibleMouvementId = m.id;
  }
  void posteId;
  return cibleMouvementId;
}

export async function pointerPaiement(params: {
  organisationId: string;
  userId: string;
  ligneId: string;
  montantCts: number;
  date: Date;
  mode: import("@/generated/prisma/enums").ModeReglement;
  reference: string | null;
}): Promise<{ dossierId: string; mouvementId: string }> {
  const { organisationId, userId, ligneId, montantCts, date, mode, reference } = params;
  if (!Number.isInteger(montantCts) || montantCts <= 0) throw new Error("Montant invalide.");
  if (Number.isNaN(date.getTime())) throw new Error("Date invalide.");

  const mouvementId = ligneId.startsWith("v|") ? await materialiser(organisationId, userId, ligneId) : ligneId;
  const m = await prisma.mouvementFinancier.findFirst({ where: { id: mouvementId, organisationId }, include: { facture: { select: { id: true } } } });
  if (!m) throw new Error("Mouvement introuvable.");
  if (m.facture) {
    // Ligne issue d'une facture : le règlement passe par la facture (qui
    // recalcule elle-même son statut et le mouvement lié).
    const { ajouterReglementFacture } = await import("@/lib/facturation/mutations");
    await ajouterReglementFacture({ organisationId, userId, factureId: m.facture.id, montantCts, date, mode, reference, commentaire: null });
    return { dossierId: m.dossierId, mouvementId: m.id };
  }
  if (m.statut === "ANNULE") throw new Error("Mouvement annulé.");

  const reel = (m.montantReelCts ?? 0) + montantCts;
  const prevu = m.montantPrevuCts ?? 0;
  const solde = prevu > 0 && reel >= prevu;
  await prisma.$transaction([
    prisma.reglementMouvement.create({ data: { organisationId, mouvementId: m.id, date, montantCts, mode, reference, createdById: userId } }),
    prisma.mouvementFinancier.update({
      where: { id: m.id },
      data: { montantReelCts: reel, dateReelle: date, statut: solde ? (m.type === "ENTREE" ? "RECU" : "PAYE") : "PARTIEL" },
    }),
  ]);
  return { dossierId: m.dossierId, mouvementId: m.id };
}
