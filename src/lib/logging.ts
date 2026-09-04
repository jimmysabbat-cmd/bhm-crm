import crypto from "node:crypto";

// ============================================================
// Logging structuré minimal (P12, section 35/36) - JSON sur stdout/stderr
// (compatible avec n'importe quel collecteur de logs managé, aucun
// service externe requis). Ne jamais logger : mot de passe, token,
// AUTH_SECRET, secret webhook, contenu complet de document, données
// fiscales complètes.
// ============================================================

export type LogFields = {
  requestId?: string;
  organisationId?: string;
  userId?: string;
  route?: string;
  action?: string;
  errorId?: string;
  [key: string]: unknown;
};

const SENSITIVE_KEYS = ["password", "token", "secret", "authsecret", "webhooksecret", "tokenhash"];

function redact(fields: LogFields): LogFields {
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function write(level: "info" | "warn" | "error", message: string, fields: LogFields = {}): void {
  const entry = { level, timestamp: new Date().toISOString(), message, ...redact(fields) };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

/**
 * Génère un identifiant d'erreur court et journalise l'erreur SERVEUR
 * complète (jamais exposée au navigateur) - la réponse utilisateur ne doit
 * afficher QUE ce message avec sa référence (section 35) : "Une erreur est
 * survenue — référence XXXXX".
 */
export function logAndGetErrorId(error: unknown, fields: LogFields = {}): string {
  const errorId = crypto.randomUUID().slice(0, 8).toUpperCase();
  logger.error(error instanceof Error ? error.message : "Erreur inconnue", {
    ...fields,
    errorId,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return errorId;
}

export function userFacingErrorMessage(errorId: string): string {
  return `Une erreur est survenue — référence ${errorId}`;
}
