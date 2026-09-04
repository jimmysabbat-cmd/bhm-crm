import type {
  AutomationTriggerType,
  AutomationActionType,
  AutomationRuleMode,
  AutomationExecutionStatus,
} from "@/generated/prisma/enums";

export type {
  AutomationTriggerType,
  AutomationActionType,
  AutomationRuleMode,
  AutomationExecutionStatus,
};

// ============================================================
// Moteur d'automatisation (P11) - types partagés entre triggers.ts,
// actions.ts, templates.ts, engine.ts et scheduler.ts. Le moteur ORCHESTRE
// des actions déjà décidées par les moteurs métier existants (P5-P10) : il
// ne recalcule et ne décide jamais rien lui-même.
// ============================================================

export type AutomationRuleData = {
  id: string;
  organisationId: string;
  code: string;
  nom: string;
  actif: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown> | null;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown> | null;
  delayMinutes: number | null;
  delayJours: number | null;
  conditions: Record<string, unknown> | null;
  mode: AutomationRuleMode;
};

// Une entité candidate détectée par un trigger - le moteur en dérive une
// clé d'idempotence stable (triggerKey) avant d'exécuter l'action.
export type TriggerMatch = {
  entityType: string;
  entityId: string;
  // Voir AutomationExecution.triggerKey (section 4 du prompt) - stable pour
  // UN "pas" précis de cadence (ex. "step-0", un statut, un jour ISO...).
  triggerKey: string;
  // Contexte libre transmis à l'action (dossierId, leadId, données déjà
  // calculées pour éviter de tout re-requêter) - jamais utilisé pour du
  // code arbitraire, seulement lu par actions.ts/templates.ts.
  context: Record<string, unknown>;
};

export type ActionOutcome = {
  status: AutomationExecutionStatus;
  result?: Record<string, unknown>;
  error?: string;
};

export type EngineRunOptions = {
  dryRun?: boolean;
  // Force le passage en mode manuel (bouton "Tester cette automation" /
  // "Exécuter") - ignore rule.mode === "MANUAL" qui bloquerait sinon toute
  // exécution automatique par le scheduler.
  manual?: boolean;
  now?: Date;
};

export type RuleRunSummary = {
  ruleId: string;
  ruleCode: string;
  matched: number;
  executed: number;
  skipped: number;
  errors: number;
  executions: {
    entityType: string;
    entityId: string;
    triggerKey: string;
    status: AutomationExecutionStatus;
    result?: Record<string, unknown>;
    error?: string;
  }[];
};

export type SchedulerRunSummary = {
  startedAt: Date;
  dryRun: boolean;
  rules: RuleRunSummary[];
};
