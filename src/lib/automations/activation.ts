import { prisma } from "@/lib/prisma";
import { detectTriggerMatches } from "./triggers";
import { toRuleData } from "./engine";

// ============================================================
// Activation des emails automatiques PAR SOCIÉTÉ.
//
// À l'activation :
// 1. les règles d'emails vers les PARTENAIRES (donneurs d'ordre,
//    sous-traitants, délégataires CEE) passent en envoi réel
//    (SEND_EMAIL / AUTO) - les emails vers les clients particuliers restent
//    en brouillon à valider ;
// 2. "ligne de base" : tout événement PASSÉ déjà présent (chantier accepté
//    il y a 3 mois, demande reçue l'an dernier...) est marqué comme traité
//    sans envoi, pour ne jamais inonder les partenaires avec l'historique.
//    Les RELANCES (paiement en retard, facture attendue...) ne sont pas
//    concernées : si elles sont dues aujourd'hui, elles partent.
// ============================================================

export const REGLES_EMAIL_PARTENAIRES_EVENEMENTS = [
  "MISSION_ST_CREEE_J0",
  "MISSION_CHANTIER_PROGRAMME_EMAIL",
  "MISSION_DATE_MODIFIEE_EMAIL",
  "DO_DEMANDE_RECUE_EMAIL",
  "DO_COMPLEMENT_REQUIS_J0",
  "DO_CHANTIER_ACCEPTE_EMAIL",
  "DO_CHANTIER_PROGRAMME_EMAIL",
  "DO_CHANTIER_TERMINE_EMAIL",
  "DO_CHANTIER_REFUSE_EMAIL",
  "DO_FACTURE_DISPONIBLE_EMAIL",
];
export const REGLES_EMAIL_PARTENAIRES_RELANCES = [
  "MISSION_ST_CREEE_J3",
  "MISSION_ST_CREEE_J7",
  "DO_COMPLEMENT_REQUIS_J1",
  "DO_COMPLEMENT_REQUIS_J3",
  "DO_FACTURE_ECHUE_J0",
  "DO_FACTURE_ECHUE_J7",
  "DO_FACTURE_ECHUE_J15",
  "ST_FACTURE_ATTENDUE_J3",
  "ST_FACTURE_ATTENDUE_J10",
  "CEE_RETARD_J0",
  "CEE_RETARD_J7",
  "CEE_RETARD_J15",
];

export async function activerEmailsAutomatiques(organisationId: string): Promise<{ reglesActivees: number; evenementsPassesIgnores: number }> {
  const codes = [...REGLES_EMAIL_PARTENAIRES_EVENEMENTS, ...REGLES_EMAIL_PARTENAIRES_RELANCES];
  const { count } = await prisma.automationRule.updateMany({
    where: { organisationId, code: { in: codes } },
    data: { actionType: "SEND_EMAIL", mode: "AUTO", actif: true },
  });

  let ignores = 0;
  const now = new Date();
  const regles = await prisma.automationRule.findMany({ where: { organisationId, code: { in: REGLES_EMAIL_PARTENAIRES_EVENEMENTS } } });
  for (const row of regles) {
    const rule = toRuleData(row);
    const matches = await detectTriggerMatches({ ...rule, triggerType: rule.triggerType }, now);
    for (const m of matches) {
      const res = await prisma.automationExecution
        .create({
          data: {
            ruleId: rule.id,
            organisationId,
            entityType: m.entityType,
            entityId: m.entityId,
            triggerKey: m.triggerKey,
            status: "SKIPPED",
            result: { reason: "Événement antérieur à l'activation des emails automatiques - non envoyé." },
          },
        })
        .then(() => 1)
        .catch(() => 0); // déjà traité : rien à faire
      ignores += res;
    }
  }

  await prisma.organisation.update({ where: { id: organisationId }, data: { emailsAutoActifs: true } });
  return { reglesActivees: count, evenementsPassesIgnores: ignores };
}

export async function desactiverEmailsAutomatiques(organisationId: string): Promise<void> {
  // Les règles restent configurées ; l'interrupteur société suffit à
  // bloquer tout envoi réel (les emails restent en brouillon).
  await prisma.organisation.update({ where: { id: organisationId }, data: { emailsAutoActifs: false } });
}
