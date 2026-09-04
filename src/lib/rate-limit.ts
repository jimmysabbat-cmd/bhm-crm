// ============================================================
// Rate limiting (P12, section 33) - abstraction simple pour login/reset
// password/acceptation d'invitation/routes sensibles.
//
// IMPORTANT : InMemoryRateLimiter n'est PAS suffisant en production
// multi-instance (chaque instance a sa propre mémoire - une attaque
// distribuée sur plusieurs instances n'est pas comptée globalement). Il
// sert de comportement par défaut en dev/single-instance et d'interface
// de référence. En production réelle, brancher un RateLimiter basé sur un
// store partagé (Redis/Upstash/KV du provider managé...) implémentant la
// même interface - AUCUN changement de code métier requis (cf.
// getRateLimiter() ci-dessous, à étendre avec un second provider sans
// refonte).
// ============================================================

export interface RateLimiter {
  /** Retourne true si l'action est AUTORISÉE (sous la limite), false si elle doit être refusée. */
  check(key: string, limit: number, windowMs: number): Promise<boolean>;
}

class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (existing.length >= limit) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}

let instance: RateLimiter | null = null;

/** Sélection du limiter actif - un seul point à étendre pour brancher un store partagé en production. */
export function getRateLimiter(): RateLimiter {
  if (!instance) instance = new InMemoryRateLimiter();
  return instance;
}

// Limites raisonnables par défaut (section 33) - ajustables sans changer
// l'abstraction.
export const RATE_LIMITS = {
  LOGIN: { limit: 8, windowMs: 5 * 60_000 },
  PASSWORD_RESET_REQUEST: { limit: 5, windowMs: 15 * 60_000 },
  INVITATION_ACCEPT: { limit: 10, windowMs: 15 * 60_000 },
} as const;
