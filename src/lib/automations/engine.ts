import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { detectTriggerMatches } from "./triggers";
import { executeAction } from "./actions";
import type { AutomationRuleData, EngineRunOptions, RuleRunSummary, TriggerMatch } from "./types";

// ============================================================
// Moteur d'automatisation central (P11, sections 1/4/5/20) - point d'entrée
// unique qui : détecte les matches d'une règle (triggers.ts), vérifie
// l'idempotence (AutomationExecution), exécute l'action (actions.ts) selon
// le mode de la règle, et journalise TOUJOURS le résultat (succès, skip,
// erreur ou dry-run).
// ============================================================

function toRuleData(row: {
  id: string;
  organisationId: string;
  code: string;
  nom: string;
  actif: boolean;
  triggerType: string;
  triggerConfig: unknown;
  actionType: string;
  actionConfig: unknown;
  delayMinutes: number | null;
  delayJours: number | null;
  conditions: unknown;
  mode: string;
}): AutomationRuleData {
  return {
    id: row.id,
    organisationId: row.organisationId,
    code: row.code,
    nom: row.nom,
    actif: row.actif,
    triggerType: row.triggerType as AutomationRuleData["triggerType"],
    triggerConfig: (row.triggerConfig as Record<string, unknown>) ?? null,
    actionType: row.actionType as AutomationRuleData["actionType"],
    actionConfig: (row.actionConfig as Record<string, unknown>) ?? null,
    delayMinutes: row.delayMinutes,
    delayJours: row.delayJours,
    conditions: (row.conditions as Record<string, unknown>) ?? null,
    mode: row.mode as AutomationRuleData["mode"],
  };
}

/**
 * Exécute UNE règle pour un ensemble de matches déjà détectés (ou détectés
 * automatiquement si non fournis). C'est le seul chemin qui écrit dans
 * AutomationExecution - jamais d'appel direct à actions.ts en dehors d'ici,
 * pour garantir que l'idempotence est TOUJOURS respectée.
 */
export async function runAutomationRule(rule: AutomationRuleData, options: EngineRunOptions = {}, matchesOverride?: TriggerMatch[]): Promise<RuleRunSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  const summary: RuleRunSummary = { ruleId: rule.id, ruleCode: rule.code, matched: 0, executed: 0, skipped: 0, errors: 0, executions: [] };
  if (!rule.actif) return summary;

  // MANUAL : ne se déclenche jamais seule via le scheduler (section 5) -
  // sauf si explicitement demandé (bouton "Exécuter"/"Tester").
  if (rule.mode === "MANUAL" && !options.manual) return summary;

  const matches = matchesOverride ?? (await detectTriggerMatches({ ...rule, triggerType: rule.triggerType }, now));
  summary.matched = matches.length;

  // PREPARE_ONLY (et MANUAL déclenché à la main) : jamais d'effet externe
  // réel (email envoyé, webhook émis) - seulement des drafts/aperçus.
  const allowExternalEffects = rule.mode === "AUTO";

  for (const match of matches) {
    if (dryRun) {
      summary.executions.push({ entityType: match.entityType, entityId: match.entityId, triggerKey: match.triggerKey, status: "DRY_RUN" });
      // Section 20/46 : le dry run peut journaliser un log EXPLICITEMENT
      // DRY_RUN, mais ne crée jamais l'effet réel (aucun executeAction()).
      await prisma.automationExecution
        .create({
          data: {
            ruleId: rule.id,
            organisationId: rule.organisationId,
            entityType: match.entityType,
            entityId: match.entityId,
            triggerKey: `dryrun-${match.triggerKey}-${now.getTime()}`,
            status: "DRY_RUN",
            result: match.context as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      continue;
    }

    const existing = await prisma.automationExecution.findUnique({
      where: { ruleId_entityType_entityId_triggerKey: { ruleId: rule.id, entityType: match.entityType, entityId: match.entityId, triggerKey: match.triggerKey } },
    });
    if (existing) {
      summary.skipped++;
      summary.executions.push({ entityType: match.entityType, entityId: match.entityId, triggerKey: match.triggerKey, status: "SKIPPED", result: { reason: "Déjà exécuté (idempotence)." } });
      continue;
    }

    let outcome;
    try {
      outcome = await executeAction(rule, match, allowExternalEffects);
    } catch (e) {
      outcome = { status: "ERROR" as const, error: e instanceof Error ? e.message : "Erreur inconnue." };
    }

    try {
      await prisma.automationExecution.create({
        data: {
          ruleId: rule.id,
          organisationId: rule.organisationId,
          entityType: match.entityType,
          entityId: match.entityId,
          triggerKey: match.triggerKey,
          status: outcome.status,
          result: outcome.result ? (outcome.result as Prisma.InputJsonValue) : undefined,
          error: outcome.error ?? null,
        },
      });
    } catch {
      // Contrainte unique déjà posée par une exécution concurrente entre-
      // temps (rejouer le scheduler en parallèle) : traité comme un skip
      // idempotent, jamais comme une erreur.
      summary.skipped++;
      summary.executions.push({ entityType: match.entityType, entityId: match.entityId, triggerKey: match.triggerKey, status: "SKIPPED", result: { reason: "Course concurrente - idempotence." } });
      continue;
    }

    if (outcome.status === "SUCCESS") summary.executed++;
    else if (outcome.status === "SKIPPED") summary.skipped++;
    else summary.errors++;
    summary.executions.push({ entityType: match.entityType, entityId: match.entityId, triggerKey: match.triggerKey, status: outcome.status, result: outcome.result, error: outcome.error });
  }

  return summary;
}

/** Charge une règle depuis la base et l'exécute (utilisé par le scheduler et les routes/API). */
export async function runAutomationRuleById(ruleId: string, organisationId: string, options: EngineRunOptions = {}): Promise<RuleRunSummary> {
  const row = await prisma.automationRule.findFirstOrThrow({ where: { id: ruleId, organisationId } });
  return runAutomationRule(toRuleData(row), options);
}

/**
 * Preview (section 19) - toujours en dry run, jamais d'effet réel, quel que
 * soit le mode de la règle.
 */
export async function previewAutomationRule(ruleId: string, organisationId: string): Promise<RuleRunSummary> {
  const row = await prisma.automationRule.findFirstOrThrow({ where: { id: ruleId, organisationId } });
  return runAutomationRule(toRuleData(row), { dryRun: true, manual: true });
}

/**
 * Déclenchement manuel explicite sur UNE entité précise (bouton "Exécuter"
 * dans l'UI, ou MANUAL_TRIGGER) - construit son propre TriggerMatch plutôt
 * que de passer par la détection automatique.
 */
export async function runManualTrigger(
  ruleId: string,
  organisationId: string,
  entityType: string,
  entityId: string,
  context: Record<string, unknown>,
  options: EngineRunOptions = {}
): Promise<RuleRunSummary> {
  const row = await prisma.automationRule.findFirstOrThrow({ where: { id: ruleId, organisationId } });
  const match: TriggerMatch = { entityType, entityId, triggerKey: options.dryRun ? `manual-${Date.now()}` : "manual", context };
  return runAutomationRule(toRuleData(row), { ...options, manual: true }, [match]);
}

export { toRuleData };
