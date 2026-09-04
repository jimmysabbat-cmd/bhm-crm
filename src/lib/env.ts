// ============================================================
// Validation centralisée des variables d'environnement (P12, section 3) -
// aucune dépendance ajoutée (équivalent Zod fait main, volontairement
// simple). En production, une variable CRITIQUE absente doit provoquer une
// erreur explicite immédiate - jamais un fallback dangereux (ex. un
// AUTH_SECRET par défaut). En développement/test, des valeurs par défaut
// raisonnables restent tolérées pour ne pas bloquer le travail local.
// ============================================================

export type EnvIssue = { variable: string; message: string; severity: "CRITICAL" | "WARNING" };

const CRITICAL_ALWAYS = ["DATABASE_URL"] as const;
// AUTH_SECRET (Auth.js v5) ou NEXTAUTH_SECRET (compat) - au moins un des
// deux est requis en production.
const CRITICAL_PRODUCTION_ONLY = ["APP_URL"] as const;
// Non bloquants pour READY/NOT_READY mais signalés (fonctionnalités qui
// resteront en Noop/désactivées tant qu'ils sont absents - jamais un
// comportement caché).
const RECOMMENDED = ["AUTOMATIONS_INTERNAL_SECRET", "STORAGE_PROVIDER", "EMAIL_SEND_ENABLED", "WEBHOOK_SEND_ENABLED"] as const;

export function validateEnv(mode: "development" | "test" | "production" = (process.env.NODE_ENV as "development" | "test" | "production") ?? "development"): EnvIssue[] {
  const issues: EnvIssue[] = [];

  for (const name of CRITICAL_ALWAYS) {
    if (!process.env[name] || process.env[name]!.trim() === "") {
      issues.push({ variable: name, message: `${name} est obligatoire (toutes les couches DB en dépendent).`, severity: "CRITICAL" });
    }
  }

  const hasAuthSecret = !!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
  if (!hasAuthSecret) {
    issues.push({ variable: "AUTH_SECRET", message: "AUTH_SECRET (ou NEXTAUTH_SECRET) est obligatoire - sans lui, les sessions ne peuvent pas être signées de façon sûre.", severity: "CRITICAL" });
  } else if (mode === "production") {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
    if (secret.length < 32) {
      issues.push({ variable: "AUTH_SECRET", message: "AUTH_SECRET doit faire au moins 32 caractères en production (secret faible détecté).", severity: "CRITICAL" });
    }
  }

  if (mode === "production") {
    for (const name of CRITICAL_PRODUCTION_ONLY) {
      if (!process.env[name] || process.env[name]!.trim() === "") {
        issues.push({ variable: name, message: `${name} est obligatoire en production (callbacks auth, liens d'invitation/réinitialisation...).`, severity: "CRITICAL" });
      }
    }
    if (process.env.APP_URL && !process.env.APP_URL.startsWith("https://")) {
      issues.push({ variable: "APP_URL", message: "APP_URL doit être en https:// en production.", severity: "CRITICAL" });
    }
  }

  for (const name of RECOMMENDED) {
    if (!process.env[name] || process.env[name]!.trim() === "") {
      issues.push({ variable: name, message: `${name} non configuré - fonctionnalité correspondante restera désactivée/Noop.`, severity: "WARNING" });
    }
  }

  return issues;
}

/** Fail-fast : à appeler une seule fois au démarrage serveur (cf. instrumentation.ts) - jamais de fallback dangereux en production. */
export function assertEnvOrThrow(mode: "development" | "test" | "production" = (process.env.NODE_ENV as "development" | "test" | "production") ?? "development"): void {
  if (mode !== "production") return;
  const critical = validateEnv(mode).filter((i) => i.severity === "CRITICAL");
  if (critical.length > 0) {
    throw new Error(`Configuration production invalide - variables manquantes/invalides : ${critical.map((i) => i.variable).join(", ")}`);
  }
}
