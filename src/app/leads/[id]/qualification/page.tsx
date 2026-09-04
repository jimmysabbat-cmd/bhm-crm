import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserContext, hasPermission, canAccessLead } from "@/lib/authz";
import { calculateLeadQualification } from "@/lib/leads/qualification";
import { canViewStudyCostsAndMargin } from "@/lib/etude/redact";
import { QualificationWorkspace } from "../../QualificationWorkspace";

export default async function LeadQualificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUserContext();

  const lead = await prisma.lead.findFirst({
    where: { id, organisationId: ctx.organisationId },
    include: {
      source: true,
      statut: true,
      dernierResultat: true,
      commercial: { select: { id: true, name: true } },
      teleprospecteur: { select: { id: true, name: true } },
      claimedBy: { select: { id: true, name: true } },
      logement: { include: { champsProvenance: true } },
      rdvs: { orderBy: { date: "desc" } },
      interactions: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } }, resultat: true } },
      dossier: { select: { id: true, reference: true } },
    },
  });
  if (!lead) notFound();
  if (!hasPermission(ctx, "VIEW_LEADS") || !canAccessLead(ctx, lead)) redirect("/leads");

  const questionnaireVersion = await prisma.questionnaireVersion.findFirst({
    where: { publiee: true, questionnaire: { code: "QUALIFICATION_COMMERCIALE", organisationId: null } },
    orderBy: { numeroVersion: "desc" },
    include: {
      questions: { orderBy: { ordre: "asc" }, include: { options: { orderBy: { ordre: "asc" } }, conditionsAffichage: true } },
    },
  });

  const reponseQuestionnaire = questionnaireVersion
    ? await prisma.reponseQuestionnaire.findUnique({
        where: { leadId_questionnaireVersionId: { leadId: lead.id, questionnaireVersionId: questionnaireVersion.id } },
        include: { reponses: true },
      })
    : null;

  const [statuts, sources, resultats, users] = await Promise.all([
    prisma.leadPipelineStatus.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.leadSource.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.resultatAppel.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.user.findMany({ where: { organisationId: ctx.organisationId, actif: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const questionsObligatoires = questionnaireVersion?.questions.filter((q) => q.obligatoire) ?? [];
  const reponduIds = new Set((reponseQuestionnaire?.reponses ?? []).map((r) => r.questionId));
  const qualification = calculateLeadQualification({
    pipelineStatutKey: lead.statut.key,
    temperature: lead.temperature,
    aRdvPlanifie: lead.rdvs.some((r) => r.statut !== "ANNULE"),
    logement: lead.logement
      ? { typeBatiment: lead.logement.typeBatiment, surfaceHabitableM2: lead.logement.surfaceHabitableM2, anneeConstruction: lead.logement.anneeConstruction, chauffagePrincipal: lead.logement.chauffagePrincipal }
      : null,
    nbReponsesQuestionnaire: reponseQuestionnaire?.reponses.length ?? 0,
    nbQuestionsObligatoiresTotal: questionsObligatoires.length,
    nbQuestionsObligatoiresRepondues: questionsObligatoires.filter((q) => reponduIds.has(q.id)).length,
  });

  const now = new Date();
  const claimActifAutre = lead.claimedById != null && lead.claimedById !== ctx.userId && lead.claimExpiresAt != null && lead.claimExpiresAt > now;

  return (
    <QualificationWorkspace
      lead={{
        id: lead.id,
        prenom: lead.prenom,
        nom: lead.nom,
        telephone: lead.telephone,
        email: lead.email,
        adresse: lead.adresse,
        codePostal: lead.codePostal,
        ville: lead.ville,
        notes: lead.notes,
        temperature: lead.temperature,
        statutId: lead.statutId,
        statutKey: lead.statut.key,
        sourceLabel: lead.source?.label ?? null,
        commercialNom: lead.commercial?.name ?? null,
        teleprospecteurNom: lead.teleprospecteur?.name ?? null,
        prochainContactAt: lead.prochainContactAt ? lead.prochainContactAt.toISOString() : null,
        dossier: lead.dossier ? { id: lead.dossier.id, reference: lead.dossier.reference } : null,
        claimedByMoi: lead.claimedById === ctx.userId && lead.claimExpiresAt != null && lead.claimExpiresAt > now,
        claimActifAutre,
        claimedByNom: lead.claimedBy?.name ?? null,
      }}
      logement={
        lead.logement
          ? {
              ...lead.logement,
              champsProvenance: lead.logement.champsProvenance.map((c) => ({
                id: c.id,
                champ: c.champ,
                source: c.source,
                confiance: c.confiance,
                valeurProposee: c.valeurProposee,
                sourceProposee: c.sourceProposee,
                refusee: c.refuseeAt != null,
              })),
            }
          : null
      }
      rdvs={lead.rdvs.map((r) => ({ id: r.id, date: r.date.toISOString(), type: r.type, statut: r.statut, adresse: r.adresse, commentaire: r.commentaire }))}
      interactions={lead.interactions.map((i) => ({
        id: i.id,
        type: i.type,
        resultatLabel: i.resultat?.label ?? null,
        notes: i.notes,
        dureeMinutes: i.dureeMinutes,
        createdAt: i.createdAt.toISOString(),
        userNom: i.user?.name ?? null,
      }))}
      qualification={qualification}
      questionnaire={
        questionnaireVersion
          ? {
              versionId: questionnaireVersion.id,
              questions: questionnaireVersion.questions.map((q) => ({
                id: q.id,
                code: q.code,
                libelle: q.libelle,
                type: q.type,
                unite: q.unite,
                obligatoire: q.obligatoire,
                section: q.section,
                options: q.options.map((o) => ({ code: o.code, libelle: o.libelle })),
                conditions: q.conditionsAffichage.map((c) => ({ questionDeclenchanteId: c.questionDeclenchanteId, valeurAttendue: c.valeurAttendue })),
              })),
            }
          : null
      }
      reponsesExistantes={(reponseQuestionnaire?.reponses ?? []).map((r) => ({
        questionId: r.questionId,
        valeurTexte: r.valeurTexte,
        valeurNombre: r.valeurNombre,
        valeurBool: r.valeurBool,
        valeurOptions: (r.valeurOptions as string[] | null) ?? null,
      }))}
      statuts={statuts.map((s) => ({ id: s.id, key: s.key, label: s.label }))}
      sources={sources.map((s) => ({ id: s.id, key: s.key, label: s.label }))}
      resultats={resultats.map((r) => ({ id: r.id, key: r.key, label: r.label }))}
      users={users}
      permissions={{
        peutModifier: hasPermission(ctx, "MANAGE_LEADS"),
        peutSimulerEtude: hasPermission(ctx, "RUN_LEAD_STUDY"),
        peutVoirCoutsMarge: canViewStudyCostsAndMargin(ctx),
      }}
    />
  );
}
