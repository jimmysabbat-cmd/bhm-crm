import { notFound, redirect } from "next/navigation";
import {
  Wallet,
  ClipboardCheck,
  TrendingUp,
  Wrench,
  Paperclip,
  CheckSquare,
  Plus,
  Trash2,
  Download,
  User,
  Lock,
  Clock,
  Zap,
  Hammer,
  Workflow,
  AlertTriangle,
  Banknote,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessDossierStudy, canAccessDossierCommunication, isPartnerRole } from "@/lib/authz";
import { buildStudyContext, isStudyStale } from "@/lib/etude/engine";
import { sanitizeScenariosForRole } from "@/lib/etude/redact";
import type { StudyContext, StudyScenario } from "@/lib/etude/types";
import { EtudeStudyPanel } from "../EtudeStudyPanel";
import { getDocumentChecklistForDossier } from "@/lib/documents/checklist";
import { DocumentChecklistPanel } from "../DocumentChecklistPanel";
import { CommunicationsPanel } from "../CommunicationsPanel";
import { getMissingDocumentsRelanceData } from "@/lib/documents/relance";
import { recalculateDossierWorkflow, calculerDelaiEtape } from "@/lib/workflow";
import { mouvementIsLate, mouvementJoursRetard, calculateBlockedAmountForDossier } from "@/lib/finance";
import { getFinancialSummaryForDossier, getCreancesForDossier, getDettesForDossier, financialDataQualityLabels } from "@/lib/financial-engine";
import { formatCents } from "@/lib/money";
import {
  precariteLabels,
  resteAChargeCents,
  typeTacheLabels,
  typeTravauxLabels,
  typeDocumentLabels,
  typeMouvementLabels,
  categorieMouvementLabels,
  statutMouvementLabels,
  partiePrenanteLabels,
  conditionExigibiliteLabels,
  statutEligibiliteReglementaireLabels,
} from "@/lib/dossier-labels";
import {
  createTache,
  updateClientInfo,
  updateEncaissements,
  updateMontage,
  updateStatut,
  updateAnahInfo,
  updateCeeInfo,
  updateTravauxInfo,
  toggleTache,
  updateTache,
  deleteTache,
  createPosteTravaux,
  updatePosteTravaux,
  deletePosteTravaux,
  uploadDocument,
  deleteDocument,
} from "../actions";
import {
  affecterProgrammeAuDossier,
  demarrerEtape,
  terminerEtape,
  bloquerEtape,
  debloquerEtape,
  ignorerEtape,
  assignerEtape,
} from "../workflow-actions";
import {
  createMouvementFinancier,
  updateMouvementFinancier,
  marquerMouvementRecu,
  marquerMouvementPaye,
  annulerMouvementFinancier,
} from "../mouvement-actions";
import { calculerReglementaireDossier, overrideCalculReglementaire } from "../reglementaire-actions";
import { compareCeeDelegates } from "@/lib/reglementaire/valuation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, statutColor } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MprAmpleurCalculator } from "@/components/ui/MprAmpleurCalculator";
import { MonogesteCalculator } from "@/components/ui/MonogesteCalculator";
import { CeeCumacCalculator } from "@/components/ui/CeeCumacCalculator";
import { inputClass, labelClass, smallInputClass } from "@/components/ui/field";

function dateInputValue(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const roleLabels: Record<string, string> = {
  ADMIN: "Direction",
  COMMERCIAL: "Commercial",
  COMPTA: "Comptabilité",
  ADMINISTRATIF: "Administratif",
  REGIE: "Régie",
  SOUS_TRAITANT: "Sous-traitant",
  COMPTABILITE: "Comptabilité",
  TECHNIQUE: "Technique",
};

const statutEtapeLabels: Record<string, string> = {
  NON_DISPONIBLE: "Non disponible",
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE: "En attente",
  BLOQUE: "Bloqué",
  TERMINE: "Terminé",
  IGNORE: "Ignoré",
  ANNULE: "Annulé",
};

const statutEtapeColor: Record<string, "slate" | "blue" | "amber" | "emerald" | "red" | "violet"> = {
  NON_DISPONIBLE: "slate",
  A_FAIRE: "blue",
  EN_COURS: "violet",
  EN_ATTENTE: "amber",
  BLOQUE: "red",
  TERMINE: "emerald",
  IGNORE: "slate",
  ANNULE: "slate",
};

const FINANCIAL_DATA_QUALITY_COLOR: Record<string, "slate" | "blue" | "amber" | "emerald" | "red"> = {
  DETAILED: "emerald",
  PARTIAL: "blue",
  LEGACY: "amber",
  INSUFFICIENT: "red",
};

export default async function DossierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireUserContext();
  // P11 (section 23/24) - la fiche dossier complète (marge, finances,
  // documents hors package...) n'est jamais accessible à un partenaire,
  // même sur un dossier où il a un poste assigné.
  if (isPartnerRole(ctx)) redirect("/partenaire");

  // Le moteur de workflow est idempotent : le rappeler à chaque affichage
  // garantit une vue toujours à jour (étapes promues, tâches auto créées)
  // sans risque de doublon ni d'effet de bord sur les étapes déjà avancées.
  const dossierAvecProgramme = await prisma.dossier.findFirst({
    where: { id, organisationId: ctx.organisationId },
    select: { id: true, programmeVersionId: true },
  });
  if (dossierAvecProgramme?.programmeVersionId) {
    await recalculateDossierWorkflow(dossierAvecProgramme.id);
  }

  const [
    dossier,
    statuts,
    mars,
    statutsAnah,
    statutsCee,
    statutsTravaux,
    sousTraitants,
    regies,
    delegatairesCee,
    types,
    modesPaiement,
    programmeVersionsPubliees,
    orgUsers,
  ] = await Promise.all([
    prisma.dossier.findFirst({
      where: { id, organisationId: ctx.organisationId },
      include: {
        client: true,
        type: true,
        statut: true,
        createdBy: true,
        modePaiementAide: true,
        mar: true,
        statutAnah: true,
        statutCee: true,
        statutTravaux: true,
        delegataireCee: true,
        taches: { orderBy: { dateEcheance: "asc" } },
        postesTravaux: {
          orderBy: { createdAt: "asc" },
          include: {
            sousTraitant: true,
            regie: true,
            calculReglementaireActif: { include: { ruleVersion: { include: { regle: true } } } },
          },
        },
        documents: { orderBy: { createdAt: "desc" } },
        mouvementsFinanciers: { orderBy: { createdAt: "desc" } },
        programmeVersion: { include: { programme: true } },
        dossierEtapes: {
          include: {
            etapeProgramme: { include: { documentsRequis: true } },
            assignedUser: { select: { id: true, name: true } },
          },
          orderBy: { etapeProgramme: { ordre: "asc" } },
        },
      },
    }),
    prisma.dossierStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.mar.findMany({ where: { actif: true, organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } }),
    prisma.statutAnah.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.statutCee.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.statutTravaux.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.sousTraitant.findMany({ where: { actif: true, organisationId: ctx.organisationId }, orderBy: { nom: "asc" } }),
    prisma.regie.findMany({ where: { actif: true, organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } }),
    prisma.delegataireCee.findMany({ where: { actif: true, organisationId: ctx.organisationId }, orderBy: { ordre: "asc" } }),
    prisma.dossierType.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.modePaiement.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.programmeVersion.findMany({
      where: { publie: true, programme: { organisationId: ctx.organisationId, actif: true } },
      include: { programme: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { organisationId: ctx.organisationId, actif: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!dossier) notFound();

  // Section 26 : la synthèse financière moteur (P6) est masquée aux rôles
  // qui ne doivent pas voir les coûts internes / la marge (COMMERCIAL,
  // RÉGIE, SOUS_TRAITANT...) - on ne calcule même pas ce que l'utilisateur
  // n'a pas le droit de voir.
  const peutVoirFinances = hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY");
  const peutVoirMarge = hasPermission(ctx, "VIEW_MARGIN");
  const peutVoirCoutsInternes = hasPermission(ctx, "VIEW_INTERNAL_COSTS");
  const [syntheseFinanciere, argentBloque, creancesDossier, dettesDossier] = peutVoirFinances
    ? await Promise.all([
        getFinancialSummaryForDossier(dossier.id),
        calculateBlockedAmountForDossier(dossier.id),
        getCreancesForDossier(dossier.id),
        peutVoirCoutsInternes ? getDettesForDossier(dossier.id) : Promise.resolve([]),
      ])
    : [null, null, [], []];

  // Section réglementaire (P7) - comparatif délégataires précalculé pour
  // chaque poste ayant un cumac connu, pour éviter tout calcul dans le JSX.
  const peutSimulerReglementaire = hasPermission(ctx, "SIMULATE_REGLEMENTATION");
  const peutGererReglementaire = hasPermission(ctx, "MANAGE_REGLEMENTATION");
  const categorieCeeDossier = dossier.client.precarite === "TRES_MODESTE" ? "TRES_MODESTE" : "CLASSIQUE";
  const comparatifCeeParPoste = new Map<string, Awaited<ReturnType<typeof compareCeeDelegates>>>();
  if (peutSimulerReglementaire) {
    for (const poste of dossier.postesTravaux) {
      if (poste.calculReglementaireActif?.kwhCumac != null && poste.ficheReglementaireCode) {
        comparatifCeeParPoste.set(
          poste.id,
          await compareCeeDelegates({
            organisationId: ctx.organisationId,
            kwhCumac: poste.calculReglementaireActif.kwhCumac,
            ficheCode: poste.ficheReglementaireCode,
            categorie: categorieCeeDossier,
            date: new Date(),
          })
        );
      }
    }
  }

  // Section étude (P8) - accès filtré par rôle ET par "propriété" du dossier
  // pour COMMERCIAL (canAccessDossierStudy, section 31). On ne charge les
  // études que si l'utilisateur a au moins VIEW_STUDY : jamais de requête
  // inutile pour un rôle qui n'y aura de toute façon pas accès.
  const peutVoirEtude = canAccessDossierStudy(ctx, dossier);
  const peutSimulerEtude = peutVoirEtude && hasPermission(ctx, "RUN_STUDY");
  const peutEnregistrerEtude = peutVoirEtude && hasPermission(ctx, "SAVE_STUDY");
  const peutAppliquerEtude = peutVoirEtude && hasPermission(ctx, "APPLY_STUDY");

  let etudeLatestProps: import("../EtudeStudyPanel").LatestEtudeProps | null = null;
  let etudeHistorique: { id: string; version: number; mode: string; createdAt: string }[] = [];
  if (peutVoirEtude) {
    const etudes = await prisma.etudeDossier.findMany({
      where: { dossierId: dossier.id },
      orderBy: { version: "desc" },
    });
    etudeHistorique = etudes.map((e) => ({ id: e.id, version: e.version, mode: e.mode, createdAt: e.createdAt.toISOString() }));

    const derniere = etudes[0];
    if (derniere) {
      const snapshot = derniere.inputsSnapshot as unknown as StudyContext;
      const results = derniere.resultsSnapshot as unknown as { scenarios: StudyScenario[]; recommendedScenarioLabel: string };
      const currentContext = await buildStudyContext(dossier.id, ctx.organisationId);
      etudeLatestProps = {
        id: derniere.id,
        version: derniere.version,
        mode: derniere.mode,
        createdAt: derniere.createdAt.toISOString(),
        dataQuality: snapshot.dataQuality,
        missingFields: snapshot.missingFields,
        scenarios: sanitizeScenariosForRole(results.scenarios, ctx),
        recommendedScenarioLabel: results.recommendedScenarioLabel,
        recommendedScenarioId: derniere.recommendedScenarioId,
        selectedScenarioId: derniere.selectedScenarioId,
        obsolete: isStudyStale(derniere, currentContext),
      };
    }
  }

  // Section documentaire (P10) - même principe que l'étude ci-dessus : ne
  // charge la checklist/les packages que si l'utilisateur a VIEW_DOCUMENTS.
  const peutVoirDocuments = hasPermission(ctx, "VIEW_DOCUMENTS");
  let documentChecklistProps: { completionPct: number; blockingCount: number; requirements: import("../DocumentChecklistPanel").ChecklistRequirementProp[]; destinations: string[] } | null = null;
  let transmissionPackagesProps: import("../DocumentChecklistPanel").TransmissionPackageProp[] = [];
  if (peutVoirDocuments) {
    const checklist = await getDocumentChecklistForDossier(dossier.id, ctx.organisationId);
    documentChecklistProps = {
      completionPct: checklist.completionPct,
      blockingCount: checklist.blockingCount,
      requirements: checklist.requirements.map((r) => ({
        requirementId: r.requirementId,
        typeDocumentId: r.typeDocumentId,
        typeDocumentCode: r.typeDocumentCode,
        typeDocumentNom: r.typeDocumentNom,
        required: r.required,
        status: r.status,
        sourceRequirementLabel: r.sourceRequirement.label,
        providedDocuments: r.providedDocuments.map((d) => ({ id: d.id, nomFichier: d.nomFichier, statut: d.statut, expired: d.expired, version: d.version })),
        responsible: r.responsible,
        destination: r.destination,
        blocking: r.blocking,
      })),
      destinations: Array.from(new Set(checklist.requirements.map((r) => r.destination).filter((d): d is NonNullable<typeof d> => d != null))) as string[],
    };

    const packages = await prisma.transmissionPackage.findMany({
      where: { dossierId: dossier.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { documents: true } } },
    });
    transmissionPackagesProps = packages.map((p) => ({
      id: p.id,
      destinationType: p.destinationType,
      destinationName: p.destinationName,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      documentsCount: p._count.documents,
    }));
  }

  // Bloc COMMUNICATIONS (P11, section 21) - même principe que les blocs
  // ci-dessus : ne charge que si l'utilisateur a la permission ET l'accès
  // par instance (canAccessDossierCommunication - un COMMERCIAL ne prépare
  // que sur SES dossiers).
  const peutVoirCommunications = canAccessDossierCommunication(ctx, dossier);
  let communicationsProps: {
    drafts: { id: string; sujet: string; destinataire: string; statut: string; createdAt: string }[];
    logs: { id: string; sujet: string; destinataire: string; statut: string; sentAt: string; erreur: string | null }[];
    relanceCount: number;
    lastRelanceAt: string | null;
    documentsManquants: number;
  } | null = null;
  if (peutVoirCommunications) {
    const [drafts, logs, relance] = await Promise.all([
      prisma.emailDraft.findMany({ where: { dossierId: dossier.id, statut: "BROUILLON" }, orderBy: { createdAt: "desc" } }),
      prisma.emailSendLog.findMany({ where: { dossierId: dossier.id }, orderBy: { sentAt: "desc" }, take: 20 }),
      getMissingDocumentsRelanceData(dossier.id, ctx.organisationId).catch(() => null),
    ]);
    communicationsProps = {
      drafts: drafts.map((d) => ({ id: d.id, sujet: d.sujet, destinataire: d.destinataire, statut: d.statut, createdAt: d.createdAt.toISOString() })),
      logs: logs.map((l) => ({ id: l.id, sujet: l.sujet, destinataire: l.destinataire, statut: l.statut, sentAt: l.sentAt.toISOString(), erreur: l.erreur })),
      relanceCount: relance?.relanceCount ?? 0,
      lastRelanceAt: relance?.lastRelanceAt?.toISOString() ?? null,
      documentsManquants: relance?.documentsManquants.length ?? 0,
    };
  }

  const resteACharge = resteAChargeCents(dossier);
  const isRenoAmpleur = dossier.type.key.startsWith("RENOVATION_AMPLEUR");
  // Seule la rénovation d'ampleur financée par l'ANAH n'a pas de CEE séparé
  // (inclus dans la prime MPR) — le CEE seul en a un, par définition.
  const noCee = dossier.type.key === "RENOVATION_AMPLEUR_ANAH";

  // Le chantier ne démarre pas (donc pas de finance réelle à suivre) tant que
  // le dossier ANAH n'a pas été accepté — les encaissements restent verrouillés
  // jusque-là pour les dossiers de rénovation d'ampleur.
  const accepteStatut = statutsAnah.find((s) => s.key === "ACCEPTE");
  const chantierDebloque =
    !isRenoAmpleur ||
    (dossier.statutAnah != null && accepteStatut != null && dossier.statutAnah.ordre >= accepteStatut.ordre);

  const echeanceDelegataireCee =
    dossier.dateDepotDelegataireCee && dossier.delegataireCee?.delaiPaiementJours
      ? addDays(dossier.dateDepotDelegataireCee, dossier.delegataireCee.delaiPaiementJours)
      : null;

  const totalAides = dossier.montantAideMPR + dossier.montantAideCEE;
  const resteAPercevoirClient = resteACharge - dossier.montantEncaisseClient;
  const resteAPercevoirMPR = dossier.montantAideMPR - dossier.montantEncaisseMPR;
  const resteAPercevoirCEE = dossier.montantAideCEE - dossier.montantEncaisseCEE;

  const totalMateriel = dossier.postesTravaux.reduce(
    (sum, p) => sum + (p.montantMaterielTTCCts ?? p.montantMaterielHTCts ?? 0),
    0
  );
  const totalSousTraitance = dossier.postesTravaux.reduce(
    (sum, p) => sum + (p.montantPoseSousTraitanceCts ?? 0),
    0
  );
  const totalRegie = dossier.postesTravaux.reduce((sum, p) => sum + (p.montantRegieCts ?? 0), 0);
  const totalCoutsChantier = totalMateriel + totalSousTraitance + totalRegie;
  const margeNette = dossier.montantDevisTTC - totalCoutsChantier;

  const dusParSousTraitant = new Map<
    string,
    { nom: string; montant: number; delaiPaiementJours: number | null }
  >();
  for (const p of dossier.postesTravaux) {
    if (p.sousTraitant && p.montantPoseSousTraitanceCts) {
      const existing = dusParSousTraitant.get(p.sousTraitant.id);
      if (existing) existing.montant += p.montantPoseSousTraitanceCts;
      else
        dusParSousTraitant.set(p.sousTraitant.id, {
          nom: p.sousTraitant.nom,
          montant: p.montantPoseSousTraitanceCts,
          delaiPaiementJours: p.sousTraitant.delaiPaiementJours,
        });
    }
  }

  const entreesARecevoir = dossier.mouvementsFinanciers.filter(
    (m) => m.type === "ENTREE" && m.statut !== "RECU" && m.statut !== "ANNULE"
  );
  const sortiesAPayer = dossier.mouvementsFinanciers.filter(
    (m) => m.type === "SORTIE" && m.statut !== "PAYE" && m.statut !== "ANNULE"
  );
  const encaisses = dossier.mouvementsFinanciers.filter((m) => m.statut === "RECU");
  const payes = dossier.mouvementsFinanciers.filter((m) => m.statut === "PAYE");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">{dossier.reference}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">
            {dossier.client.prenom} {dossier.client.nom}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {dossier.type.label}
            {dossier.createdBy && ` · créé par ${dossier.createdBy.name}`}
          </p>
        </div>
        <Badge color={statutColor(dossier.statut.key)}>{dossier.statut.label}</Badge>
      </div>

      <details className="group rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/50">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4">
          <User className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-slate-900">Client & type de dossier</span>
          <span className="ml-auto text-xs font-medium text-slate-400 group-hover:text-emerald-600">
            Modifier
          </span>
        </summary>
        <form
          action={updateClientInfo}
          className="grid grid-cols-2 gap-4 border-t border-slate-100 p-5"
        >
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="space-y-1">
            <label className={labelClass}>Prénom</label>
            <input name="prenom" defaultValue={dossier.client.prenom} required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Nom</label>
            <input name="nom" defaultValue={dossier.client.nom} required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Email</label>
            <input name="email" type="email" defaultValue={dossier.client.email ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Téléphone</label>
            <input name="telephone" defaultValue={dossier.client.telephone ?? ""} className={inputClass} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className={labelClass}>Adresse</label>
            <input name="adresse" defaultValue={dossier.client.adresse ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Code postal</label>
            <input name="codePostal" defaultValue={dossier.client.codePostal ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Ville</label>
            <input name="ville" defaultValue={dossier.client.ville ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Précarité</label>
            <select name="precarite" defaultValue={dossier.client.precarite ?? ""} className={inputClass}>
              <option value="">—</option>
              {Object.entries(precariteLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Zone climatique</label>
            <select name="zoneClimatique" defaultValue={dossier.client.zoneClimatique ?? ""} className={inputClass}>
              <option value="">—</option>
              <option value="H1">H1</option>
              <option value="H2">H2</option>
              <option value="H3">H3</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Surface habitable (m²)</label>
            <input
              name="surfaceHabitableM2"
              type="number"
              defaultValue={dossier.client.surfaceHabitableM2 ?? ""}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Année de construction</label>
            <input
              name="anneeConstruction"
              type="number"
              defaultValue={dossier.client.anneeConstruction ?? ""}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Type de dossier</label>
            <select name="typeId" defaultValue={dossier.typeId} required className={inputClass}>
              {!types.some((t) => t.id === dossier.typeId) && (
                <option value={dossier.typeId}>{dossier.type.label} (archivé)</option>
              )}
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex items-end">
            <Button type="submit">Enregistrer</Button>
          </div>
        </form>
      </details>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Statut</CardTitle>
          </CardHeader>
          <div className="space-y-4 p-5">
            <form
              action={async (formData: FormData) => {
                "use server";
                await updateStatut(dossier.id, String(formData.get("statutId")));
              }}
              className="flex gap-2"
            >
              <select name="statutId" defaultValue={dossier.statutId} className={inputClass}>
                {statuts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button type="submit" className="shrink-0">
                OK
              </Button>
            </form>

            <dl className="space-y-1.5 text-sm">
              {dossier.modePaiementAide && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Mode paiement aide</dt>
                  <dd className="text-slate-700">{dossier.modePaiementAide.label}</dd>
                </div>
              )}
              {dossier.mar && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">MAR</dt>
                  <dd className="text-slate-700">{dossier.mar.nom}</dd>
                </div>
              )}
              {dossier.delegataireCee && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Délégataire CEE</dt>
                  <dd className="text-slate-700">{dossier.delegataireCee.nom}</dd>
                </div>
              )}
              {dossier.client.precarite && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Précarité</dt>
                  <dd className="text-slate-700">{precariteLabels[dossier.client.precarite]}</dd>
                </div>
              )}
            </dl>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Montage financier</CardTitle>
          </CardHeader>
          <form action={updateMontage} className="space-y-2.5 p-5">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-slate-500" title="Qui avance l'argent (client, ANAH, BHM en mandataire...)">
                Circuit de versement
              </label>
              <select
                name="modePaiementAideId"
                defaultValue={dossier.modePaiementAideId ?? ""}
                className={`w-40 ${smallInputClass}`}
              >
                <option value="">—</option>
                {modesPaiement.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-slate-500">Devis TTC</label>
              <input
                name="montantDevisTTC"
                type="number"
                step="0.01"
                defaultValue={dossier.montantDevisTTC / 100}
                className={`w-32 text-right ${smallInputClass}`}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="text-slate-500">Aide MPR / ANAH</label>
              <input
                id="montantAideMPR-detail"
                name="montantAideMPR"
                type="number"
                step="0.01"
                defaultValue={dossier.montantAideMPR / 100}
                className={`w-32 text-right ${smallInputClass}`}
              />
            </div>
            {isRenoAmpleur && (
              <MprAmpleurCalculator
                targetInputId="montantAideMPR-detail"
                defaultPrecarite={dossier.client.precarite}
                defaultDateDepot={dateInputValue(dossier.dateDepotAnah)}
              />
            )}
            {!isRenoAmpleur && (
              <MonogesteCalculator
                targetInputId="montantAideMPR-detail"
                defaultPrecarite={dossier.client.precarite}
              />
            )}
            {!noCee && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <label className="text-slate-500">Aide CEE</label>
                <input
                  name="montantAideCEE"
                  type="number"
                  step="0.01"
                  defaultValue={dossier.montantAideCEE / 100}
                  className={`w-32 text-right ${smallInputClass}`}
                />
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2.5 text-sm font-semibold text-slate-900">
              <span>Reste à charge client</span>
              <span>{formatCents(resteACharge)}</span>
            </div>
            <Button type="submit" variant="secondary" className="mt-1 text-xs">
              Enregistrer
            </Button>
          </form>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-600" />
            <CardTitle>Encaissements & dates chantier</CardTitle>
          </div>
        </CardHeader>
        {!chantierDebloque ? (
          <div className="flex items-start gap-3 p-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm text-slate-600">
                Cette section se débloque une fois le dossier <strong>accepté par l&apos;ANAH</strong>.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Statut ANAH actuel : {dossier.statutAnah?.label ?? "non renseigné"} — le chantier ne
                démarrant pas tout de suite, pas besoin de suivre l&apos;argent réel pour l&apos;instant.
              </p>
            </div>
          </div>
        ) : (
        <form action={updateEncaissements} className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
          <input type="hidden" name="dossierId" value={dossier.id} />
          <div className="space-y-1">
            <label className={labelClass}>Encaissé client (€)</label>
            <input
              name="montantEncaisseClient"
              type="number"
              step="0.01"
              defaultValue={dossier.montantEncaisseClient / 100}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Encaissé MPR (€)</label>
            <input
              name="montantEncaisseMPR"
              type="number"
              step="0.01"
              defaultValue={dossier.montantEncaisseMPR / 100}
              className={inputClass}
            />
          </div>
          {!noCee && (
            <div className="space-y-1">
              <label className={labelClass}>Encaissé CEE (€)</label>
              <input
                name="montantEncaisseCEE"
                type="number"
                step="0.01"
                defaultValue={dossier.montantEncaisseCEE / 100}
                className={inputClass}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className={labelClass}>Début travaux</label>
            <input
              name="dateDebutTravaux"
              type="date"
              defaultValue={dateInputValue(dossier.dateDebutTravaux)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Fin travaux</label>
            <input
              name="dateFinTravaux"
              type="date"
              defaultValue={dateInputValue(dossier.dateFinTravaux)}
              className={inputClass}
            />
          </div>
          {!noCee && (
            <>
              <div className="space-y-1">
                <label className={labelClass}>Délégataire CEE</label>
                <select name="delegataireCeeId" defaultValue={dossier.delegataireCeeId ?? ""} className={inputClass}>
                  <option value="">—</option>
                  {delegatairesCee.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Date de dépôt chez le délégataire</label>
                <input
                  name="dateDepotDelegataireCee"
                  type="date"
                  defaultValue={dateInputValue(dossier.dateDepotDelegataireCee)}
                  className={inputClass}
                />
              </div>
              {echeanceDelegataireCee && (
                <div className="col-span-2 flex items-center gap-1.5 text-xs text-slate-500 sm:col-span-3">
                  <Clock className="h-3.5 w-3.5" />
                  Paiement CEE attendu vers le {echeanceDelegataireCee.toLocaleDateString("fr-FR")}
                  {dossier.delegataireCee && ` (délai ${dossier.delegataireCee.delaiPaiementJours} j)`}
                </div>
              )}
            </>
          )}
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Enregistrer
            </Button>
          </div>
        </form>
        )}
      </Card>

      {isRenoAmpleur && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-emerald-600" />
              <CardTitle>Suivi ANAH</CardTitle>
            </div>
          </CardHeader>
          <form action={updateAnahInfo} className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="space-y-1">
              <label className={labelClass}>MAR</label>
              <select name="marId" defaultValue={dossier.marId ?? ""} className={inputClass}>
                <option value="">—</option>
                {mars.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Statut ANAH</label>
              <select name="statutAnahId" defaultValue={dossier.statutAnahId ?? ""} className={inputClass}>
                <option value="">—</option>
                {statutsAnah.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Date de dépôt ANAH</label>
              <input
                name="dateDepotAnah"
                type="date"
                defaultValue={dateInputValue(dossier.dateDepotAnah)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Date d&apos;octroi ANAH</label>
              <input
                name="dateOctroiAnah"
                type="date"
                defaultValue={dateInputValue(dossier.dateOctroiAnah)}
                className={inputClass}
              />
            </div>
            <div className="col-span-2 flex items-end sm:col-span-4">
              <Button type="submit">Enregistrer</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {!noCee && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-600" />
                <CardTitle>Flux CEE</CardTitle>
              </div>
            </CardHeader>
            <form action={updateCeeInfo} className="space-y-3 p-5">
              <input type="hidden" name="dossierId" value={dossier.id} />
              <div className="space-y-1">
                <label className={labelClass}>Statut CEE</label>
                <select name="statutCeeId" defaultValue={dossier.statutCeeId ?? ""} className={inputClass}>
                  <option value="">—</option>
                  {statutsCee.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Hammer className="h-4 w-4 text-emerald-600" />
              <CardTitle>Flux Travaux / Chantier</CardTitle>
            </div>
          </CardHeader>
          <form action={updateTravauxInfo} className="space-y-3 p-5">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="space-y-1">
              <label className={labelClass}>Statut travaux</label>
              <select
                name="statutTravauxId"
                defaultValue={dossier.statutTravauxId ?? ""}
                className={inputClass}
              >
                <option value="">—</option>
                {statutsTravaux.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Enregistrer</Button>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-emerald-600" />
            <CardTitle>Workflow du dossier</CardTitle>
            {dossier.programmeVersion && (
              <span className="text-xs text-slate-400">
                {dossier.programmeVersion.programme.nom} · v{dossier.programmeVersion.numeroVersion}
              </span>
            )}
          </div>
        </CardHeader>
        {!dossier.programmeVersionId ? (
          <form action={affecterProgrammeAuDossier} className="flex flex-wrap items-end gap-2 p-5">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="min-w-[16rem] space-y-1">
              <label className={labelClass}>Programme</label>
              <select name="programmeVersionId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un programme...
                </option>
                {programmeVersionsPubliees.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.programme.nom} · v{v.numeroVersion}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Démarrer un programme</Button>
            {programmeVersionsPubliees.length === 0 && (
              <p className="w-full text-xs text-slate-400">
                Aucun programme publié - configurable depuis Paramétrage → Programmes.
              </p>
            )}
          </form>
        ) : (
          <div className="divide-y divide-slate-100">
            {dossier.dossierEtapes.map((de) => {
              const delais = calculerDelaiEtape(de);
              const responsableLabel =
                de.assignedUser?.name ?? (de.etapeProgramme.roleResponsable ? roleLabels[de.etapeProgramme.roleResponsable] : null);
              const documentsRequis = de.etapeProgramme.documentsRequis;
              const documentsPresents = new Set(dossier.documents.map((doc) => doc.type));

              return (
                <div key={de.id} className="space-y-2.5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">{de.etapeProgramme.ordre + 1}.</span>
                    <span className="font-medium text-slate-900">{de.etapeProgramme.nom}</span>
                    <Badge color={statutEtapeColor[de.statut]}>{statutEtapeLabels[de.statut]}</Badge>
                    {delais.enRetard && (
                      <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        Retard : +{delais.joursRetard} j
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Responsable : {responsableLabel ?? "non assigné"}</span>
                    {de.dateDebut && <span>Début : {new Date(de.dateDebut).toLocaleDateString("fr-FR")}</span>}
                    {de.dateEcheance && (
                      <span>Échéance : {new Date(de.dateEcheance).toLocaleDateString("fr-FR")}</span>
                    )}
                    {delais.joursEcoules != null && de.statut !== "TERMINE" && (
                      <span>Depuis {delais.joursEcoules} j</span>
                    )}
                    {de.dateTerminee && (
                      <span>Terminée le {new Date(de.dateTerminee).toLocaleDateString("fr-FR")}</span>
                    )}
                  </div>

                  {de.bloque && de.raisonBlocage && (
                    <p className="text-xs text-red-600">Bloqué : {de.raisonBlocage}</p>
                  )}

                  {documentsRequis.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {documentsRequis.map((doc) => (
                        <Badge key={doc.id} color={documentsPresents.has(doc.typeDocument) ? "emerald" : "amber"}>
                          {typeDocumentLabels[doc.typeDocument]} : {documentsPresents.has(doc.typeDocument) ? "reçu" : "manquant"}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {de.statut === "A_FAIRE" && (
                      <form action={async () => { "use server"; await demarrerEtape(de.id); }}>
                        <Button type="submit" variant="secondary" className="text-xs">
                          Démarrer
                        </Button>
                      </form>
                    )}
                    {(de.statut === "A_FAIRE" || de.statut === "EN_COURS") && (
                      <form action={async () => { "use server"; await terminerEtape(de.id); }}>
                        <Button type="submit" variant="secondary" className="text-xs">
                          Terminer
                        </Button>
                      </form>
                    )}
                    {(de.statut === "A_FAIRE" || de.statut === "EN_COURS") && (
                      <form action={bloquerEtape.bind(null, de.id)} className="flex items-center gap-1.5">
                        <input
                          name="raison"
                          placeholder="Raison du blocage"
                          className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        />
                        <Button type="submit" variant="ghost" className="text-xs">
                          Bloquer
                        </Button>
                      </form>
                    )}
                    {de.statut === "BLOQUE" && (
                      <form action={async () => { "use server"; await debloquerEtape(de.id); }}>
                        <Button type="submit" variant="secondary" className="text-xs">
                          Débloquer
                        </Button>
                      </form>
                    )}
                    {!de.etapeProgramme.obligatoire && (de.statut === "A_FAIRE" || de.statut === "EN_COURS") && (
                      <form action={async () => { "use server"; await ignorerEtape(de.id); }}>
                        <Button type="submit" variant="ghost" className="text-xs">
                          Ignorer
                        </Button>
                      </form>
                    )}
                    {!["TERMINE", "IGNORE", "ANNULE"].includes(de.statut) && (
                      <form action={assignerEtape.bind(null, de.id)} className="flex items-center gap-1.5">
                        <select
                          name="userId"
                          defaultValue={de.assignedUserId ?? ""}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          <option value="">Non assigné</option>
                          {orgUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="ghost" className="text-xs">
                          Assigner
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {peutVoirFinances && syntheseFinanciere && argentBloque && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600" />
              <CardTitle>Synthèse financière</CardTitle>
              <Badge color={FINANCIAL_DATA_QUALITY_COLOR[syntheseFinanciere.financialDataQuality]}>
                {financialDataQualityLabels[syntheseFinanciere.financialDataQuality]}
              </Badge>
            </div>
            <a href="#flux-financiers" className="text-xs font-medium text-slate-400 hover:text-emerald-700">
              Voir le détail des mouvements →
            </a>
          </CardHeader>
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <dl className="space-y-1.5 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  CA contractuel
                </p>
                <Row label="CA contractuel" value={formatCents(syntheseFinanciere.caContractuelCts)} strong />
                <Row label="Encaissements" value={formatCents(syntheseFinanciere.encaisseCts)} />
                <Row label="Reste à encaisser" value={formatCents(syntheseFinanciere.resteAEncaisserCts)} />
                {syntheseFinanciere.caConfidence !== "HIGH" && (
                  <p className="pt-1 text-xs text-amber-600">
                    CA {syntheseFinanciere.caConfidence === "LOW" ? "inconnu" : "incertain"} ({syntheseFinanciere.caSource})
                  </p>
                )}
              </dl>

              {peutVoirCoutsInternes ? (
                <dl className="space-y-1.5 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Coûts</p>
                  <Row label="Coûts prévus" value={formatCents(syntheseFinanciere.sortiesPrevuesCts)} />
                  <Row label="Coûts payés" value={formatCents(syntheseFinanciere.sortiesPayeesCts)} />
                  <Row label="Reste à payer" value={formatCents(syntheseFinanciere.resteAPayerCts)} />
                </dl>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Coûts</p>
                  <p className="text-xs text-slate-400">Non visible pour votre rôle.</p>
                </dl>
              )}

              {peutVoirMarge ? (
                <dl className="space-y-1.5 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Marge</p>
                  <Row
                    label="Prévisionnelle"
                    value={`${formatCents(syntheseFinanciere.margePrevisionnelleCts)}${
                      syntheseFinanciere.margePrevisionnellePct != null ? ` (${syntheseFinanciere.margePrevisionnellePct.toFixed(0)} %)` : ""
                    }`}
                  />
                  <Row
                    label="Sur coûts réels connus"
                    value={`${formatCents(syntheseFinanciere.margeSurCoutsReelsCts)}${
                      syntheseFinanciere.margeSurCoutsReelsPct != null ? ` (${syntheseFinanciere.margeSurCoutsReelsPct.toFixed(0)} %)` : ""
                    }`}
                  />
                  <Row
                    label="Réalisée"
                    value={syntheseFinanciere.margeRealisee.statut === "CALCULEE" ? formatCents(syntheseFinanciere.margeRealisee.margeCts) : "Non calculable"}
                    strong
                  />
                  {syntheseFinanciere.margeRealisee.statut === "NON_CALCULABLE" && (
                    <p className="pt-0.5 text-xs text-slate-400">{syntheseFinanciere.margeRealisee.raison}</p>
                  )}
                </dl>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Marge</p>
                  <p className="text-xs text-slate-400">Non visible pour votre rôle.</p>
                </dl>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-4 sm:grid-cols-3">
              <dl className="space-y-1.5 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Créances ({creancesDossier.length})
                </p>
                {creancesDossier.length === 0 ? (
                  <p className="text-xs text-slate-400">Aucune créance ouverte.</p>
                ) : (
                  creancesDossier.map((c) => (
                    <Row key={c.mouvementId} label={c.debiteurNom ?? partiePrenanteLabels[c.debiteurType ?? "CLIENT"]} value={formatCents(c.resteCts)} />
                  ))
                )}
              </dl>
              {peutVoirCoutsInternes && (
                <dl className="space-y-1.5 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Dettes ({dettesDossier.length})
                  </p>
                  {dettesDossier.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune dette ouverte.</p>
                  ) : (
                    dettesDossier.map((d) => (
                      <Row
                        key={d.mouvementId}
                        label={d.beneficiaireNom ?? partiePrenanteLabels[d.beneficiaireType ?? "AUTRE"]}
                        value={formatCents(d.resteCts)}
                      />
                    ))
                  )}
                </dl>
              )}
              <dl className="space-y-1.5 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Argent bloqué</p>
                <Row label="Total" value={formatCents(argentBloque.montantBloqueCts)} strong />
                {argentBloque.details.map((d) => (
                  <Row key={d.origine} label={d.origine} value={formatCents(d.montantCts)} />
                ))}
              </dl>
            </div>

            {syntheseFinanciere.limites.length > 0 && (
              <ul className="border-t border-slate-100 pt-3 text-xs text-slate-400">
                {syntheseFinanciere.limites.map((l) => (
                  <li key={l}>· {l}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {peutVoirEtude && (
        <EtudeStudyPanel
          dossierId={dossier.id}
          peutSimuler={peutSimulerEtude}
          peutEnregistrer={peutEnregistrerEtude}
          peutAppliquer={peutAppliquerEtude}
          latestEtude={etudeLatestProps}
          historique={etudeHistorique}
        />
      )}

      {documentChecklistProps && (
        <DocumentChecklistPanel
          dossierId={dossier.id}
          completionPct={documentChecklistProps.completionPct}
          blockingCount={documentChecklistProps.blockingCount}
          requirements={documentChecklistProps.requirements}
          destinations={documentChecklistProps.destinations}
          packages={transmissionPackagesProps}
          permissions={{
            peutUpload: hasPermission(ctx, "UPLOAD_DOCUMENTS"),
            peutValider: hasPermission(ctx, "VALIDATE_DOCUMENTS"),
            peutCreerPackage: hasPermission(ctx, "CREATE_TRANSMISSION_PACKAGE"),
            peutTelechargerPackage: hasPermission(ctx, "DOWNLOAD_TRANSMISSION_PACKAGE"),
          }}
        />
      )}

      {communicationsProps && (
        <CommunicationsPanel
          dossierId={dossier.id}
          drafts={communicationsProps.drafts}
          logs={communicationsProps.logs}
          relanceCount={communicationsProps.relanceCount}
          lastRelanceAt={communicationsProps.lastRelanceAt}
          documentsManquants={communicationsProps.documentsManquants}
          peutPreparer={hasPermission(ctx, "PREPARE_COMMUNICATIONS")}
          peutEnvoyer={hasPermission(ctx, "SEND_EMAIL_ACTION")}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <CardTitle>Finances du dossier</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <dl className="space-y-1.5 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Reste à percevoir
              </p>
              <Row label="Côté client" value={formatCents(resteAPercevoirClient)} />
              <Row label="Côté MPR" value={formatCents(resteAPercevoirMPR)} />
              <Row label="Côté CEE" value={formatCents(resteAPercevoirCEE)} />
              <Row label="Total aides prévues" value={formatCents(totalAides)} />
            </dl>
            <dl className="space-y-1.5 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Coûts chantier
              </p>
              <Row label="Matériel" value={formatCents(totalMateriel)} />
              <Row label="Sous-traitance" value={formatCents(totalSousTraitance)} />
              <Row label="Régie" value={formatCents(totalRegie)} />
              <Row label="Total coûts" value={formatCents(totalCoutsChantier)} />
            </dl>
            <dl className="space-y-1.5 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Rentabilité
              </p>
              <Row label="Devis TTC" value={formatCents(dossier.montantDevisTTC)} />
              <Row label="Total coûts" value={formatCents(totalCoutsChantier)} />
              <Row label="Marge nette" value={formatCents(margeNette)} strong />
            </dl>
          </div>

          {dusParSousTraitant.size > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Montant dû aux sous-traitants
              </p>
              <ul className="space-y-1.5 text-sm">
                {Array.from(dusParSousTraitant.values()).map((d) => {
                  const echeance =
                    dossier.dateFinTravaux && d.delaiPaiementJours
                      ? addDays(dossier.dateFinTravaux, d.delaiPaiementJours)
                      : null;
                  return (
                    <li key={d.nom} className="flex justify-between">
                      <span className="text-slate-600">
                        {d.nom}
                        {d.delaiPaiementJours && (
                          <span className="ml-1.5 text-xs text-slate-400">
                            (délai {d.delaiPaiementJours} j
                            {echeance ? `, échéance ${echeance.toLocaleDateString("fr-FR")}` : ""})
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-slate-900">{formatCents(d.montant)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <div id="flux-financiers" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-emerald-600" />
            <CardTitle>Flux financiers</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-5 p-5">
          {(
            [
              { titre: "Entrées à recevoir", items: entreesARecevoir },
              { titre: "Sorties à payer", items: sortiesAPayer },
              { titre: "Encaissé", items: encaisses },
              { titre: "Payé", items: payes },
            ] as const
          ).map(
            (groupe) =>
              groupe.items.length > 0 && (
                <div key={groupe.titre}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {groupe.titre} ({groupe.items.length})
                  </p>
                  <div className="space-y-2">
                    {groupe.items.map((m) => {
                      const late = mouvementIsLate(m);
                      const retard = mouvementJoursRetard(m);
                      const montant = m.montantReelCts ?? m.montantPrevuCts ?? 0;
                      return (
                        <form
                          key={m.id}
                          action={updateMouvementFinancier.bind(null, m.id)}
                          className="rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                        >
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                            <select name="type" defaultValue={m.type} className={smallInputClass}>
                              {Object.entries(typeMouvementLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <select name="categorie" defaultValue={m.categorie} className={smallInputClass}>
                              {Object.entries(categorieMouvementLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <input
                              name="payeur"
                              placeholder="Payeur"
                              defaultValue={m.payeur ?? ""}
                              className={smallInputClass}
                            />
                            <select name="payeurType" defaultValue={m.payeurType ?? ""} className={smallInputClass}>
                              <option value="">Type payeur…</option>
                              {Object.entries(partiePrenanteLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <input
                              name="beneficiaire"
                              placeholder="Bénéficiaire"
                              defaultValue={m.beneficiaire ?? ""}
                              className={smallInputClass}
                            />
                            <select
                              name="beneficiaireType"
                              defaultValue={m.beneficiaireType ?? ""}
                              className={smallInputClass}
                            >
                              <option value="">Type bénéficiaire…</option>
                              {Object.entries(partiePrenanteLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <select
                              name="exigibleQuand"
                              defaultValue={m.exigibleQuand ?? ""}
                              className={smallInputClass}
                            >
                              <option value="">Exigible quand…</option>
                              {Object.entries(conditionExigibiliteLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <input
                              name="montantPrevu"
                              type="number"
                              step="0.01"
                              placeholder="Prévu (€)"
                              defaultValue={m.montantPrevuCts != null ? m.montantPrevuCts / 100 : ""}
                              className={smallInputClass}
                            />
                            <input
                              name="montantReel"
                              type="number"
                              step="0.01"
                              placeholder="Réel (€)"
                              defaultValue={m.montantReelCts != null ? m.montantReelCts / 100 : ""}
                              className={smallInputClass}
                            />
                            <input
                              name="datePrevue"
                              type="date"
                              defaultValue={dateInputValue(m.datePrevue)}
                              className={smallInputClass}
                            />
                            <input
                              name="dateReelle"
                              type="date"
                              defaultValue={dateInputValue(m.dateReelle)}
                              className={smallInputClass}
                            />
                            <select name="statut" defaultValue={m.statut} className={smallInputClass}>
                              {Object.entries(statutMouvementLabels).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <input
                              name="commentaire"
                              placeholder="Commentaire"
                              defaultValue={m.commentaire ?? ""}
                              className={`sm:col-span-2 ${smallInputClass}`}
                            />
                            <span className="flex items-center justify-end text-sm font-semibold text-slate-900">
                              {formatCents(montant)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {late && (
                              <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                                <AlertTriangle className="h-3 w-3" />
                                En retard de {retard} j
                              </span>
                            )}
                            <Button type="submit" variant="secondary" className="text-xs">
                              Enregistrer
                            </Button>
                            {m.type === "ENTREE" && m.statut !== "RECU" && m.statut !== "ANNULE" && (
                              <button
                                type="submit"
                                formAction={async () => {
                                  "use server";
                                  await marquerMouvementRecu(m.id);
                                }}
                                className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                              >
                                Marquer reçu
                              </button>
                            )}
                            {m.type === "SORTIE" && m.statut !== "PAYE" && m.statut !== "ANNULE" && (
                              <button
                                type="submit"
                                formAction={async () => {
                                  "use server";
                                  await marquerMouvementPaye(m.id);
                                }}
                                className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                              >
                                Marquer payé
                              </button>
                            )}
                            {m.statut !== "ANNULE" && (
                              <button
                                type="submit"
                                formAction={async () => {
                                  "use server";
                                  await annulerMouvementFinancier(m.id);
                                }}
                                className="text-xs font-medium text-slate-400 hover:text-red-600"
                              >
                                Annuler
                              </button>
                            )}
                          </div>
                        </form>
                      );
                    })}
                  </div>
                </div>
              )
          )}
          {dossier.mouvementsFinanciers.length === 0 && (
            <p className="text-sm text-slate-400">Aucun mouvement financier.</p>
          )}

          <form
            action={createMouvementFinancier}
            className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-6"
          >
            <input type="hidden" name="dossierId" value={dossier.id} />
            <select name="type" defaultValue="ENTREE" className={smallInputClass}>
              {Object.entries(typeMouvementLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select name="categorie" defaultValue="ENCAISSEMENT_CLIENT" className={smallInputClass}>
              {Object.entries(categorieMouvementLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input name="payeur" placeholder="Payeur" className={smallInputClass} />
            <select name="payeurType" defaultValue="" className={smallInputClass}>
              <option value="">Type payeur…</option>
              {Object.entries(partiePrenanteLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input name="beneficiaire" placeholder="Bénéficiaire" className={smallInputClass} />
            <select name="beneficiaireType" defaultValue="" className={smallInputClass}>
              <option value="">Type bénéficiaire…</option>
              {Object.entries(partiePrenanteLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select name="exigibleQuand" defaultValue="" className={smallInputClass}>
              <option value="">Exigible quand…</option>
              {Object.entries(conditionExigibiliteLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input name="montantPrevu" type="number" step="0.01" placeholder="Prévu (€)" className={smallInputClass} />
            <input name="datePrevue" type="date" className={smallInputClass} />
            <div className="col-span-2 sm:col-span-6">
              <Button type="submit" className="text-xs">
                <Plus className="h-3.5 w-3.5" />
                Ajouter un mouvement
              </Button>
            </div>
          </form>
        </div>
      </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-emerald-600" />
            <CardTitle>Postes de travaux</CardTitle>
          </div>
        </CardHeader>

        <div className="space-y-4 p-5">
          <div className="space-y-4">
            {dossier.postesTravaux.map((poste) => (
              <form
                key={poste.id}
                action={updatePosteTravaux.bind(null, poste.id)}
                className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <label className={labelClass}>Type de travaux</label>
                    <select name="type" defaultValue={poste.type} className={inputClass}>
                      {Object.entries(typeTravauxLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Surface (m²)</label>
                    <input
                      name="surfaceM2"
                      type="number"
                      step="0.01"
                      defaultValue={poste.surfaceM2 ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>CUMAC (kWh)</label>
                    <input
                      name="montantCumac"
                      type="number"
                      defaultValue={poste.montantCumac ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Prime calculée (€)</label>
                    <input
                      name="montantPrimeCalcule"
                      type="number"
                      step="0.01"
                      defaultValue={poste.montantPrimeCalculeCts ? poste.montantPrimeCalculeCts / 100 : ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Sous-traitant</label>
                    <select name="sousTraitantId" defaultValue={poste.sousTraitantId ?? ""} className={inputClass}>
                      <option value="">—</option>
                      {sousTraitants.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Montant pose sous-traitance (€)</label>
                    <input
                      name="montantPoseSousTraitance"
                      type="number"
                      step="0.01"
                      defaultValue={
                        poste.montantPoseSousTraitanceCts ? poste.montantPoseSousTraitanceCts / 100 : ""
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Régie</label>
                    <select name="regieId" defaultValue={poste.regieId ?? ""} className={inputClass}>
                      <option value="">—</option>
                      {regies.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Montant pose régie (€)</label>
                    <input
                      name="montantRegie"
                      type="number"
                      step="0.01"
                      defaultValue={poste.montantRegieCts ? poste.montantRegieCts / 100 : ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Matériel HT (€)</label>
                    <input
                      name="montantMaterielHT"
                      type="number"
                      step="0.01"
                      defaultValue={poste.montantMaterielHTCts ? poste.montantMaterielHTCts / 100 : ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Matériel TTC (€)</label>
                    <input
                      name="montantMaterielTTC"
                      type="number"
                      step="0.01"
                      defaultValue={poste.montantMaterielTTCCts ? poste.montantMaterielTTCCts / 100 : ""}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" variant="secondary" className="text-xs">
                    Enregistrer
                  </Button>
                  <Button
                    type="submit"
                    variant="ghost"
                    className="text-xs"
                    formAction={async () => {
                      "use server";
                      await deletePosteTravaux(poste.id, dossier.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                </div>
              </form>
            ))}
            {dossier.postesTravaux
              .filter((poste) => poste.type === "PAC_AIR_EAU" && peutSimulerReglementaire)
              .map((poste) => {
                const calcul = poste.calculReglementaireActif;
                const comparatif = comparatifCeeParPoste.get(poste.id) ?? [];
                return (
                  <div key={`${poste.id}-reglementaire`} className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Réglementaire CEE — BAR-TH-171 ({poste.surfaceM2 ?? "?"} m²)
                    </p>

                    {calcul ? (
                      <div className="space-y-2 rounded-lg bg-white p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span>
                            <strong>Statut :</strong>{" "}
                            {statutEligibiliteReglementaireLabels[calcul.overrideStatutEligibilite ?? calcul.statutEligibilite]}
                          </span>
                          <span>
                            <strong>kWh cumac :</strong> {(calcul.overrideKwhCumac ?? calcul.kwhCumac)?.toLocaleString("fr-FR") ?? "—"}
                          </span>
                          <span>
                            <strong>Version :</strong> {calcul.ruleVersion.regle.code} v{calcul.ruleVersion.numeroVersion}
                          </span>
                        </div>
                        <p className="text-slate-500">
                          Applicable du {calcul.ruleVersion.dateDebutEffet.toLocaleDateString("fr-FR")} au{" "}
                          {calcul.ruleVersion.dateFinEffet ? calcul.ruleVersion.dateFinEffet.toLocaleDateString("fr-FR") : "aujourd'hui"} — source :{" "}
                          {calcul.ruleVersion.sourceNom}.
                        </p>
                        {calcul.overrideReason && (
                          <p className="text-amber-700">
                            <strong>Override :</strong> {calcul.overrideReason}
                          </p>
                        )}
                        {peutGererReglementaire && (
                          <form
                            action={overrideCalculReglementaire.bind(null, calcul.id)}
                            className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2"
                          >
                            <div className="space-y-1">
                              <label className={labelClass}>Override kWh cumac</label>
                              <input
                                name="overrideKwhCumac"
                                type="number"
                                className={smallInputClass}
                                defaultValue={calcul.overrideKwhCumac ?? ""}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className={labelClass}>Override statut</label>
                              <select
                                name="overrideStatutEligibilite"
                                className={smallInputClass}
                                defaultValue={calcul.overrideStatutEligibilite ?? ""}
                              >
                                <option value="">—</option>
                                {Object.entries(statutEligibiliteReglementaireLabels).map(([v, l]) => (
                                  <option key={v} value={v}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="min-w-[10rem] flex-1 space-y-1">
                              <label className={labelClass}>Raison (obligatoire)</label>
                              <input name="overrideReason" className={smallInputClass} defaultValue={calcul.overrideReason ?? ""} />
                            </div>
                            <Button type="submit" variant="ghost" className="text-xs">
                              Override
                            </Button>
                          </form>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Aucun calcul réglementaire enregistré pour ce poste.</p>
                    )}

                    <form action={calculerReglementaireDossier} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <input type="hidden" name="dossierId" value={dossier.id} />
                      <input type="hidden" name="posteTravauxId" value={poste.id} />
                      <input type="hidden" name="ficheCode" value="BAR-TH-171" />
                      <select name="zoneClimatique" defaultValue={dossier.client.zoneClimatique ?? ""} className={smallInputClass}>
                        <option value="">Zone…</option>
                        <option value="H1">H1</option>
                        <option value="H2">H2</option>
                        <option value="H3">H3</option>
                      </select>
                      <input
                        name="surfaceChauffeeM2"
                        type="number"
                        step="0.01"
                        placeholder="Surface chauffée (m²)"
                        defaultValue={poste.surfaceM2 ?? ""}
                        className={smallInputClass}
                      />
                      <select name="etasBande" className={smallInputClass} defaultValue="">
                        <option value="">ETAS…</option>
                        <option value="111a140">111 % ≤ ETAS &lt; 140 %</option>
                        <option value="plus140">ETAS ≥ 140 %</option>
                      </select>
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          variant="secondary"
                          className="text-xs"
                          formAction={async (formData: FormData) => {
                            "use server";
                            formData.set("type", "SIMULATION");
                            await calculerReglementaireDossier(formData);
                          }}
                        >
                          Simuler
                        </Button>
                        <Button
                          type="submit"
                          className="text-xs"
                          formAction={async (formData: FormData) => {
                            "use server";
                            formData.set("type", "OFFICIEL");
                            await calculerReglementaireDossier(formData);
                          }}
                        >
                          Enregistrer officiel
                        </Button>
                      </div>
                    </form>

                    {comparatif.length > 0 && (
                      <div className="rounded-lg bg-white p-3 text-xs">
                        <p className="mb-1.5 font-medium text-slate-700">Comparaison valorisation par délégataire</p>
                        <table className="w-full text-xs">
                          <thead className="text-left text-slate-400">
                            <tr>
                              <th className="py-1 pr-3">Délégataire</th>
                              <th className="py-1 pr-3 text-right">Taux €/MWhc</th>
                              <th className="py-1 pr-3 text-right">Prime</th>
                              <th className="py-1 text-right">Délai paiement</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparatif.map((c) => (
                              <tr key={c.delegataireId} className="border-t border-slate-100">
                                <td className="py-1 pr-3">{c.delegataireNom}</td>
                                <td className="py-1 pr-3 text-right">{(c.tauxCtsParMwhc / 100).toFixed(2)} €</td>
                                <td className="py-1 pr-3 text-right font-medium">{formatCents(c.primeCts)}</td>
                                <td className="py-1 text-right">{c.delaiPaiementJours ?? "—"} j</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            {dossier.postesTravaux.length === 0 && (
              <p className="text-sm text-slate-400">Aucun poste de travaux.</p>
            )}
          </div>

          <form action={createPosteTravaux} className="space-y-3 border-t border-slate-100 pt-4">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <label className={labelClass}>Type de travaux</label>
                <select name="type" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choisir...
                  </option>
                  {Object.entries(typeTravauxLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Surface (m²)</label>
                <input name="surfaceM2" type="number" step="0.01" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>CUMAC (kWh)</label>
                <input id="createPosteCumac" name="montantCumac" type="number" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Prime calculée (€)</label>
                <input
                  id="createPostePrime"
                  name="montantPrimeCalcule"
                  type="number"
                  step="0.01"
                  className={inputClass}
                />
              </div>
              <CeeCumacCalculator
                cumacTargetId="createPosteCumac"
                primeTargetId="createPostePrime"
                defaultZone={dossier.client.zoneClimatique}
                delegataires={delegatairesCee}
                defaultDelegataireOptionKey={
                  dossier.delegataireCeeId
                    ? `${dossier.delegataireCeeId}:${
                        dossier.client.precarite === "TRES_MODESTE" ? "tm" : "classique"
                      }`
                    : undefined
                }
              />
              <div className="space-y-1">
                <label className={labelClass}>Sous-traitant</label>
                <select name="sousTraitantId" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {sousTraitants.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Montant pose sous-traitance (€)</label>
                <input name="montantPoseSousTraitance" type="number" step="0.01" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Régie</label>
                <select name="regieId" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {regies.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Montant pose régie (€)</label>
                <input name="montantRegie" type="number" step="0.01" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Matériel HT (€)</label>
                <input name="montantMaterielHT" type="number" step="0.01" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Matériel TTC (€)</label>
                <input name="montantMaterielTTC" type="number" step="0.01" className={inputClass} />
              </div>
            </div>
            <Button type="submit">
              <Plus className="h-4 w-4" />
              Ajouter un poste
            </Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-emerald-600" />
            <CardTitle>Documents & photos</CardTitle>
          </div>
        </CardHeader>

        <div className="space-y-4 p-5">
          <ul className="space-y-1">
            {dossier.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"
              >
                <a
                  href={`/api/documents/${doc.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 font-medium text-slate-800 hover:text-emerald-700"
                >
                  <Download className="h-3.5 w-3.5 text-slate-400" />
                  {doc.nomFichier}
                </a>
                <Badge color="slate">{typeDocumentLabels[doc.type]}</Badge>
                <span className="text-xs text-slate-400">
                  {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await deleteDocument(doc.id, dossier.id);
                  }}
                  className="ml-auto"
                >
                  <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                    Supprimer
                  </button>
                </form>
              </li>
            ))}
            {dossier.documents.length === 0 && (
              <p className="text-sm text-slate-400">Aucun document.</p>
            )}
          </ul>

          <form
            action={uploadDocument}
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
          >
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="space-y-1">
              <label className={labelClass}>Type</label>
              <select name="type" className={inputClass} defaultValue="DEVIS">
                {Object.entries(typeDocumentLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Fichier</label>
              <input name="file" type="file" required className={inputClass} />
            </div>
            <Button type="submit">Téléverser</Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-emerald-600" />
            <CardTitle>Tâches & relances</CardTitle>
          </div>
        </CardHeader>

        <div className="space-y-4 p-5">
          <ul className="space-y-1">
            {dossier.taches.map((t) => (
              <li key={t.id} className="rounded-lg px-2 py-2 hover:bg-slate-50">
                <form
                  action={updateTache.bind(null, t.id)}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <button
                    type="submit"
                    formAction={async () => {
                      "use server";
                      await toggleTache(t.id, t.statut !== "FAIT");
                    }}
                    className={`h-4 w-4 shrink-0 rounded border transition ${
                      t.statut === "FAIT"
                        ? "border-emerald-600 bg-emerald-600"
                        : "border-slate-300 hover:border-emerald-500"
                    }`}
                    aria-label="Basculer statut"
                  />
                  <input
                    name="titre"
                    defaultValue={t.titre}
                    className={`min-w-[10rem] flex-1 ${smallInputClass} ${
                      t.statut === "FAIT" ? "text-slate-400 line-through" : ""
                    }`}
                  />
                  <select name="type" defaultValue={t.type} className={smallInputClass}>
                    {Object.entries(typeTacheLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="dateEcheance"
                    type="date"
                    defaultValue={dateInputValue(t.dateEcheance)}
                    className={smallInputClass}
                  />
                  <Button type="submit" variant="secondary" className="text-xs">
                    Enregistrer
                  </Button>
                  <button
                    type="submit"
                    formAction={async () => {
                      "use server";
                      await deleteTache(t.id, dossier.id);
                    }}
                    className="text-xs font-medium text-slate-400 hover:text-red-600"
                  >
                    Supprimer
                  </button>
                </form>
              </li>
            ))}
            {dossier.taches.length === 0 && <p className="text-sm text-slate-400">Aucune tâche.</p>}
          </ul>

          <form action={createTache} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="dossierId" value={dossier.id} />
            <div className="space-y-1">
              <label className={labelClass}>Titre</label>
              <input name="titre" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Type</label>
              <select name="type" className={inputClass} defaultValue="RELANCE_CLIENT">
                {Object.entries(typeTacheLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Échéance</label>
              <input name="dateEcheance" type="date" required className={inputClass} />
            </div>
            <Button type="submit">Ajouter</Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={strong ? "font-semibold text-slate-900" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
