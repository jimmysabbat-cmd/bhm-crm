import type { PrismaClient } from "../src/generated/prisma/client";

// ============================================================
// Templates email + règles d'automatisation par défaut (P11, sections 7 et
// 18). Templates globaux (organisationId null, même pattern que le
// référentiel documentaire P10) - variables STRICTEMENT limitées à
// ALLOWED_VARIABLES (src/lib/automations/templates.ts), jamais de données
// sensibles (marge, taux interne, fiscal - section 30). Règles seedées PAR
// organisation existante (RegleRelance suit le même principe), toutes en
// mode PREPARE_ONLY (aucun envoi automatique par défaut - section 7/35) et
// idempotentes (findFirst + create, jamais d'upsert sur un couple contenant
// un champ nullable - même raisonnement que Questionnaire/LeadSource P9).
// ============================================================

const TEMPLATES: { code: string; nom: string; sujetTemplate: string; bodyTemplate: string }[] = [
  {
    code: "DEMANDE_PIECES",
    nom: "Demande de pièces",
    sujetTemplate: "Pièces à fournir pour votre dossier {{dossier.reference}}",
    bodyTemplate:
      "Bonjour {{client.prenom}},\n\nPour poursuivre votre dossier {{dossier.reference}}, il nous manque :\n{{documents.manquants}}\n\nMerci de nous les transmettre dès que possible.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RAPPEL_PIECES",
    nom: "Rappel pièces",
    sujetTemplate: "Rappel - pièces en attente pour votre dossier {{dossier.reference}}",
    bodyTemplate:
      "Bonjour {{client.prenom}},\n\nNous n'avons pas encore reçu les pièces suivantes pour votre dossier {{dossier.reference}} :\n{{documents.manquants}}\n\nMerci de nous les transmettre rapidement afin de ne pas retarder votre dossier.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "PIECE_REFUSEE",
    nom: "Pièce refusée",
    sujetTemplate: "Pièce à renvoyer - dossier {{dossier.reference}}",
    bodyTemplate:
      "Bonjour {{client.prenom}},\n\nLa pièce \"{{document.nom}}\" que vous nous avez transmise pour le dossier {{dossier.reference}} n'a pas pu être validée : {{document.motifRefus}}\n\nMerci de nous en transmettre une nouvelle version.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DEVIS_ENVOYE",
    nom: "Devis envoyé",
    sujetTemplate: "Votre devis {{dossier.reference}}",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVeuillez trouver ci-joint votre devis pour le dossier {{dossier.reference}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RELANCE_DEVIS",
    nom: "Relance devis",
    sujetTemplate: "Votre devis {{dossier.reference}} est toujours disponible",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVotre devis pour le dossier {{dossier.reference}} est toujours en attente de votre retour. N'hésitez pas à nous contacter pour toute question.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "CONFIRMATION_RDV",
    nom: "Confirmation RDV",
    sujetTemplate: "Confirmation de votre rendez-vous",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nNous vous confirmons votre rendez-vous du {{rdv.date}}{{rdv.adresse}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RAPPEL_RDV",
    nom: "Rappel RDV",
    sujetTemplate: "Rappel - rendez-vous à venir",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nPetit rappel : vous avez rendez-vous le {{rdv.date}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DOSSIER_DEPOSE",
    nom: "Dossier déposé",
    sujetTemplate: "Votre dossier {{dossier.reference}} a été déposé",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVotre dossier {{dossier.reference}} a bien été déposé auprès de l'organisme concerné. Nous vous tiendrons informé de son avancement.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DOSSIER_ACCEPTE",
    nom: "Dossier accepté",
    sujetTemplate: "Bonne nouvelle - votre dossier {{dossier.reference}} est accepté",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVotre dossier {{dossier.reference}} a été accepté. Nous revenons vers vous rapidement pour la suite.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DEMANDE_RESTE_A_CHARGE",
    nom: "Demande de reste à charge",
    sujetTemplate: "Reste à charge - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nAfin de poursuivre votre dossier {{dossier.reference}}, merci de bien vouloir régler le reste à charge convenu.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "INFO_CHANTIER",
    nom: "Information chantier",
    sujetTemplate: "Information chantier - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVoici une information concernant l'avancement des travaux de votre dossier {{dossier.reference}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DEMANDE_DOCUMENTS_APRES_TRAVAUX",
    nom: "Demande documents après travaux",
    sujetTemplate: "Pièces à fournir après travaux - dossier {{dossier.reference}}",
    bodyTemplate:
      "Bonjour {{client.prenom}},\n\nMaintenant que les travaux sont terminés, il nous manque encore :\n{{documents.manquants}}\n\nMerci de nous les transmettre pour finaliser votre dossier.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "INFO_CEE",
    nom: "Information CEE",
    sujetTemplate: "Information prime CEE - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nVoici une information concernant votre prime CEE pour le dossier {{dossier.reference}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RELANCE_PAIEMENT",
    nom: "Relance paiement",
    sujetTemplate: "Rappel de paiement - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour {{client.prenom}},\n\nNous n'avons pas encore reçu votre règlement pour le dossier {{dossier.reference}}. Merci de régulariser dans les meilleurs délais.\n\nCordialement,\n{{organisation.nom}}",
  },
  // P16 - missions ST, portail donneur d'ordre, RDV, action requise.
  // "lien.url" pointe toujours vers l'écran exact du destinataire (jamais
  // le tableau de bord) - cf. src/lib/links.ts.
  {
    code: "MISSION_ST_NOUVELLE",
    nom: "Nouvelle mission sous-traitant",
    sujetTemplate: "Nouvelle mission - dossier {{dossier.reference}}",
    bodyTemplate:
      "Bonjour,\n\nUne nouvelle mission vous a été confiée pour le dossier {{dossier.reference}} :\n- Prestation : {{mission.prestation}}\n- Client : {{mission.destinataire}}\n- Adresse : {{dossier.adresse}}\n- Dates souhaitées : {{mission.dateDebut}} → {{mission.dateFin}}\n- Instructions : {{mission.instructions}}\n\nVoir / accepter la mission : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "MISSION_ST_ACCEPTEE",
    nom: "Mission acceptée par le sous-traitant",
    sujetTemplate: "Mission acceptée - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nLa mission du dossier {{dossier.reference}} a été acceptée par le sous-traitant.\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "MISSION_ST_REFUSEE",
    nom: "Mission refusée par le sous-traitant",
    sujetTemplate: "Mission refusée - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nLa mission du dossier {{dossier.reference}} a été REFUSÉE par le sous-traitant.\nMotif : {{mission.motifRefus}}\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "CHANTIER_PROGRAMME",
    nom: "Chantier programmé",
    sujetTemplate: "Chantier programmé - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nLe chantier du dossier {{dossier.reference}} est programmé du {{mission.dateDebut}} au {{mission.dateFin}}.\n\nVoir la mission : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "CHANTIER_DATE_MODIFIEE",
    nom: "Date de chantier modifiée",
    sujetTemplate: "Date modifiée - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nLes dates du chantier du dossier {{dossier.reference}} ont été mises à jour : {{mission.dateDebut}} → {{mission.dateFin}}.\n\nVoir la mission : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "CHANTIER_TERMINE",
    nom: "Chantier terminé",
    sujetTemplate: "Chantier terminé - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nLe chantier du dossier {{dossier.reference}} est marqué comme terminé - contrôle / facturation requis.\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_NOUVELLE_DEMANDE",
    nom: "Nouvelle demande donneur d'ordre",
    sujetTemplate: "Nouvelle demande reçue - {{demande.reference}}",
    bodyTemplate: "Bonjour,\n\nUne nouvelle demande a été reçue de {{donneurOrdre.nom}} : {{demande.reference}}.\n\nVoir la demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_COMPLEMENT_REQUIS",
    nom: "Complément requis (donneur d'ordre)",
    sujetTemplate: "Information requise pour votre chantier {{demande.reference}}",
    bodyTemplate:
      "Bonjour,\n\nUne information est requise pour votre chantier {{demande.reference}} :\n{{demande.message}}\n\nComplétez votre demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_COMPLEMENT_RECU",
    nom: "Complément reçu (donneur d'ordre)",
    sujetTemplate: "Complément reçu - {{demande.reference}}",
    bodyTemplate: "Bonjour,\n\n{{donneurOrdre.nom}} a répondu à la demande de complément pour {{demande.reference}} :\n{{demande.message}}\n\nVoir la demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_CHANTIER_ACCEPTE",
    nom: "Chantier accepté (donneur d'ordre)",
    sujetTemplate: "Votre chantier {{demande.reference}} est accepté",
    bodyTemplate: "Bonjour,\n\nVotre chantier {{demande.reference}} a été accepté et va être programmé.\n\nSuivre votre demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_CHANTIER_PROGRAMME",
    nom: "Chantier programmé (donneur d'ordre)",
    sujetTemplate: "Votre chantier {{demande.reference}} est programmé",
    bodyTemplate: "Bonjour,\n\nVotre chantier {{demande.reference}} est programmé.\n\nSuivre votre demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_CHANTIER_TERMINE",
    nom: "Chantier terminé (donneur d'ordre)",
    sujetTemplate: "Votre chantier {{demande.reference}} est terminé",
    bodyTemplate: "Bonjour,\n\nVotre chantier {{demande.reference}} est terminé.\n\nSuivre votre demande : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "DO_FACTURE_DISPONIBLE",
    nom: "Facture disponible (donneur d'ordre)",
    sujetTemplate: "Facture {{facture.numero}} disponible",
    bodyTemplate: "Bonjour,\n\nLa facture {{facture.numero}} ({{facture.montantTTC}}, échéance {{facture.echeance}}) est disponible.\n\nVoir la facture : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "FACTURE_ECHUE",
    nom: "Facture échue",
    sujetTemplate: "Facture {{facture.numero}} échue",
    bodyTemplate: "Bonjour,\n\nLa facture {{facture.numero}} ({{facture.montantTTC}}) est échue depuis le {{facture.echeance}} et reste impayée.\n\nVoir la facture : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "REGIE_NOUVEAU_LEAD",
    nom: "Nouveau lead",
    sujetTemplate: "Nouveau lead reçu",
    bodyTemplate: "Bonjour,\n\nUn nouveau lead a été enregistré : {{client.prenom}} {{client.nom}}.\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RDV_CREE",
    nom: "RDV créé",
    sujetTemplate: "Nouveau RDV le {{rdv.date}}",
    bodyTemplate: "Bonjour {{commercial.nom}},\n\nUn RDV {{rdv.type}} a été créé le {{rdv.date}}{{dossier.reference}}.\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "RDV_MODIFIE",
    nom: "RDV modifié ou annulé",
    sujetTemplate: "RDV modifié - {{rdv.date}}",
    bodyTemplate: "Bonjour {{commercial.nom}},\n\nLe RDV {{rdv.type}} du {{rdv.date}} a été modifié ou annulé.\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
  {
    code: "ACTION_REQUISE",
    nom: "Action requise",
    sujetTemplate: "Action requise - dossier {{dossier.reference}}",
    bodyTemplate: "Bonjour,\n\nUne action est requise sur le dossier {{dossier.reference}}.\n\nVoir le dossier : {{lien.url}}\n\nCordialement,\n{{organisation.nom}}",
  },
];

// Règles par défaut (section 18) - toutes PREPARE_ONLY, aucune n'envoie de
// mail/webhook réel tant qu'un humain n'a pas explicitement reconfiguré le
// mode en AUTO. La cadence de relance documentaire (section 9, J0/J+3/J+7/
// J+14) est modélisée par 4 règles DOCUMENT_MISSING successives (un
// "stepIndex" chacune) plutôt qu'un second moteur de délais concurrent de
// RegleRelance : RegleRelance reste dédiée aux relances d'ÉTAPE de
// workflow (P5/P9), inchangée.
function defaultRules(organisationId: string) {
  return [
    { code: "DOC_MANQUANT_J0", nom: "Document manquant - 1ère demande (J0)", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 0 }, actionType: "PREPARE_DOCUMENT_REQUEST", actionConfig: {}, delayJours: 0 },
    { code: "DOC_MANQUANT_J3", nom: "Document manquant - rappel (J+3)", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 1 }, actionType: "PREPARE_DOCUMENT_REQUEST", actionConfig: {}, delayJours: 3 },
    { code: "DOC_MANQUANT_J7", nom: "Document manquant - rappel (J+7)", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 2 }, actionType: "PREPARE_DOCUMENT_REQUEST", actionConfig: {}, delayJours: 7 },
    { code: "DOC_MANQUANT_J14_ADMIN", nom: "Document manquant - alerte admin (J+14)", triggerType: "DOCUMENT_MISSING", triggerConfig: { stepIndex: 3 }, actionType: "CREATE_TASK", actionConfig: { titre: "Pièces toujours manquantes après 14 jours", assigneRole: "ADMINISTRATIF", typeTache: "RELANCE_CLIENT" }, delayJours: 14 },
    { code: "DOC_REFUSE_TACHE", nom: "Document refusé - tâche admin", triggerType: "DOCUMENT_REJECTED", triggerConfig: {}, actionType: "CREATE_TASK", actionConfig: { titre: "Pièce refusée à traiter", assigneRole: "ADMINISTRATIF", typeTache: "RELANCE_CLIENT" }, delayJours: 0 },
    { code: "DOC_REFUSE_EMAIL", nom: "Document refusé - préparation relance", triggerType: "DOCUMENT_REJECTED", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "PIECE_REFUSEE" }, delayJours: 0 },
    { code: "LEAD_RAPPEL_ECHU", nom: "Rappel lead échu", triggerType: "LEAD_CALLBACK_DUE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { title: "Rappel lead échu", message: "Un rappel programmé est arrivé à échéance." }, delayJours: 0 },
    { code: "RDV_SOUS_24H", nom: "RDV sous 24h", triggerType: "APPOINTMENT_UPCOMING", triggerConfig: { withinHours: 24 }, actionType: "CREATE_NOTIFICATION", actionConfig: { title: "RDV dans moins de 24h", message: "Un rendez-vous a lieu dans moins de 24 heures." }, delayJours: 0 },
    { code: "PAIEMENT_RETARD", nom: "Paiement en retard", triggerType: "FINANCIAL_PAYMENT_LATE", triggerConfig: {}, actionType: "CREATE_TASK", actionConfig: { titre: "Paiement en retard à relancer", assigneRole: "COMPTABILITE", typeTache: "RELANCE_CLIENT" }, delayJours: 0 },
    { code: "ETUDE_OBSOLETE", nom: "Étude obsolète", triggerType: "STUDY_STALE", triggerConfig: {}, actionType: "CREATE_TASK", actionConfig: { titre: "Étude à recalculer (données modifiées)", typeTache: "AUTRE" }, delayJours: 2 },
    { code: "WORKFLOW_ETAPE_RETARD", nom: "Étape workflow en retard", triggerType: "WORKFLOW_STEP_LATE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { title: "Étape en retard", message: "Une étape de workflow a dépassé son échéance." }, delayJours: 0 },

    // P16 - missions ST/régie, portail donneur d'ordre, RDV.
    { code: "MISSION_ST_CREEE_J0", nom: "Mission créée - email sous-traitant (J0)", triggerType: "MISSION_ST_CREEE", triggerConfig: { stepIndex: 0 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "MISSION_ST_NOUVELLE" }, delayJours: 0 },
    { code: "MISSION_ST_CREEE_J3", nom: "Mission créée - relance sous-traitant (J+3)", triggerType: "MISSION_ST_CREEE", triggerConfig: { stepIndex: 1 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "MISSION_ST_NOUVELLE" }, delayJours: 3 },
    { code: "MISSION_ST_CREEE_J7", nom: "Mission créée - relance sous-traitant (J+7)", triggerType: "MISSION_ST_CREEE", triggerConfig: { stepIndex: 2 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "MISSION_ST_NOUVELLE" }, delayJours: 7 },
    { code: "MISSION_ST_ACCEPTEE_NOTIF", nom: "Mission acceptée - notif tenant", triggerType: "MISSION_ST_ACCEPTEE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMIN", title: "Mission acceptée", message: "Un sous-traitant a accepté une mission." }, delayJours: 0 },
    { code: "MISSION_ST_REFUSEE_NOTIF", nom: "Mission refusée - notif urgente tenant", triggerType: "MISSION_ST_REFUSEE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMIN", title: "Mission refusée", message: "Un sous-traitant a REFUSÉ une mission - action requise." }, delayJours: 0 },
    { code: "MISSION_CHANTIER_PROGRAMME_EMAIL", nom: "Chantier programmé - email ST", triggerType: "MISSION_CHANTIER_PROGRAMME", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "CHANTIER_PROGRAMME" }, delayJours: 0 },
    { code: "MISSION_CHANTIER_PROGRAMME_NOTIF", nom: "Chantier programmé - notif interne", triggerType: "MISSION_CHANTIER_PROGRAMME", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMINISTRATIF", title: "Chantier programmé", message: "Un chantier vient d'être programmé." }, delayJours: 0 },
    { code: "MISSION_DATE_MODIFIEE_EMAIL", nom: "Date de chantier modifiée - email ST", triggerType: "MISSION_DATE_MODIFIEE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "CHANTIER_DATE_MODIFIEE" }, delayJours: 0 },
    { code: "MISSION_TERMINEE_NOTIF", nom: "Chantier terminé - contrôle/facturation", triggerType: "MISSION_TERMINEE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMINISTRATIF", title: "Chantier terminé", message: "Chantier terminé - contrôle / facturation requis." }, delayJours: 0 },

    { code: "DO_DEMANDE_RECUE_NOTIF", nom: "Nouvelle demande DO - notif tenant", triggerType: "DO_DEMANDE_RECUE", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMIN", title: "Nouvelle demande donneur d'ordre", message: "Un donneur d'ordre a envoyé un nouveau chantier." }, delayJours: 0 },
    { code: "DO_DEMANDE_RECUE_EMAIL", nom: "Nouvelle demande DO - email tenant", triggerType: "DO_DEMANDE_RECUE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_NOUVELLE_DEMANDE" }, delayJours: 0 },
    { code: "DO_COMPLEMENT_REQUIS_J0", nom: "Complément requis - email DO (J0)", triggerType: "DO_COMPLEMENT_REQUIS", triggerConfig: { stepIndex: 0 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_COMPLEMENT_REQUIS" }, delayJours: 0 },
    { code: "DO_COMPLEMENT_REQUIS_J1", nom: "Complément requis - relance urgente DO (J+1)", triggerType: "DO_COMPLEMENT_REQUIS", triggerConfig: { stepIndex: 1 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_COMPLEMENT_REQUIS" }, delayJours: 1 },
    { code: "DO_COMPLEMENT_REQUIS_J3", nom: "Complément requis - relance DO (J+3)", triggerType: "DO_COMPLEMENT_REQUIS", triggerConfig: { stepIndex: 2 }, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_COMPLEMENT_REQUIS" }, delayJours: 3 },
    { code: "DO_COMPLEMENT_RECU_NOTIF", nom: "Complément reçu - notif tenant", triggerType: "DO_COMPLEMENT_RECU", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "ADMINISTRATIF", title: "Complément reçu", message: "Le donneur d'ordre a répondu à une demande de complément." }, delayJours: 0 },
    { code: "DO_CHANTIER_ACCEPTE_EMAIL", nom: "Chantier accepté - email DO", triggerType: "DO_CHANTIER_ACCEPTE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_CHANTIER_ACCEPTE" }, delayJours: 0 },
    { code: "DO_CHANTIER_PROGRAMME_EMAIL", nom: "Chantier programmé - email DO", triggerType: "DO_CHANTIER_PROGRAMME", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_CHANTIER_PROGRAMME" }, delayJours: 0 },
    { code: "DO_CHANTIER_TERMINE_EMAIL", nom: "Chantier terminé - email DO", triggerType: "DO_CHANTIER_TERMINE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_CHANTIER_TERMINE" }, delayJours: 0 },
    { code: "DO_FACTURE_DISPONIBLE_EMAIL", nom: "Facture disponible - email DO", triggerType: "DO_FACTURE_DISPONIBLE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "DO_FACTURE_DISPONIBLE" }, delayJours: 0 },

    { code: "REGIE_NOUVEAU_LEAD_NOTIF", nom: "Nouveau lead - notif tenant", triggerType: "REGIE_NOUVEAU_LEAD", triggerConfig: {}, actionType: "CREATE_NOTIFICATION", actionConfig: { targetRole: "COMMERCIAL", title: "Nouveau lead", message: "Un nouveau lead a été enregistré." }, delayJours: 0 },
    { code: "RDV_CREE_EMAIL", nom: "RDV créé - email commercial", triggerType: "RDV_CREE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "RDV_CREE" }, delayJours: 0 },
    { code: "RDV_MODIFIE_EMAIL", nom: "RDV modifié/annulé - email commercial", triggerType: "RDV_MODIFIE_OU_ANNULE", triggerConfig: {}, actionType: "PREPARE_EMAIL", actionConfig: { templateCode: "RDV_MODIFIE" }, delayJours: 0 },
  ].map((r) => ({ ...r, organisationId, mode: "PREPARE_ONLY" as const, actif: true }));
}

export async function seedAutomations(prisma: PrismaClient, organisationId: string) {
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i];
    const existing = await prisma.emailTemplate.findFirst({ where: { organisationId: null, code: t.code } });
    if (existing) {
      await prisma.emailTemplate.update({ where: { id: existing.id }, data: { nom: t.nom, sujetTemplate: t.sujetTemplate, bodyTemplate: t.bodyTemplate } });
    } else {
      await prisma.emailTemplate.create({ data: { organisationId: null, code: t.code, nom: t.nom, sujetTemplate: t.sujetTemplate, bodyTemplate: t.bodyTemplate } });
    }
  }
  console.log(`Templates email prêts (${TEMPLATES.length}).`);

  let created = 0;
  for (const rule of defaultRules(organisationId)) {
    const existing = await prisma.automationRule.findFirst({ where: { organisationId, code: rule.code } });
    if (existing) continue;
    await prisma.automationRule.create({ data: rule as never });
    created++;
  }
  console.log(`Règles d'automatisation par défaut prêtes (${created} créées).`);
}
