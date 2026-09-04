// ============================================================
// Abstraction fournisseur email (P11, sections 10/11/34/35) - le CRM doit
// continuer à fonctionner sans fournisseur réel configuré. En dev/test/QA,
// ou tant qu'aucun SMTP n'est configuré, NoopEmailProvider est utilisé :
// aucun envoi réseau réel, jamais.
// ============================================================

export type SendEmailParams = {
  to: string;
  subject: string;
  body: string;
};

export type SendEmailResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export interface EmailProvider {
  readonly name: string;
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
  validateConfiguration(): { valid: boolean; reason?: string };
}

/** Fournisseur par défaut - ne fait jamais d'appel réseau. Toujours "valide" (rien à configurer). */
export class NoopEmailProvider implements EmailProvider {
  readonly name = "noop";

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    return { ok: true, providerMessageId: `noop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, error: undefined };
  }

  validateConfiguration(): { valid: boolean; reason?: string } {
    return { valid: true };
  }

  // Exposé pour les tests/QA : jamais utilisé par le moteur lui-même.
  static describe(params: SendEmailParams): string {
    return `[NoopEmailProvider] to=${params.to} subject="${params.subject}"`;
  }
}

/**
 * SMTP générique optionnel (section 11) - configurable via variables
 * d'environnement, AUCUN secret en dur dans le code. N'effectue un envoi
 * réel QUE si EMAIL_SEND_ENABLED=true (section 34) ; sinon se comporte
 * comme NoopEmailProvider pour rester sûr par défaut en dev/QA (section
 * 35). L'envoi SMTP réel nécessiterait une dépendance externe (ex.
 * nodemailer) non ajoutée en P11 - cette classe prépare l'abstraction et
 * valide la configuration, sans effectuer l'appel réseau tant qu'aucune
 * lib SMTP n'est branchée : à cadrer explicitement si un vrai envoi SMTP
 * est requis.
 */
export class SMTPEmailProvider implements EmailProvider {
  readonly name = "smtp";

  constructor(
    private readonly config: {
      host: string | undefined;
      port: number | undefined;
      user: string | undefined;
      pass: string | undefined;
      from: string | undefined;
    }
  ) {}

  validateConfiguration(): { valid: boolean; reason?: string } {
    if (!this.config.host || !this.config.port || !this.config.from) {
      return { valid: false, reason: "SMTP_HOST/SMTP_PORT/SMTP_FROM manquant(s) - configuration incomplète." };
    }
    return { valid: true };
  }

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    const check = this.validateConfiguration();
    if (!check.valid) return { ok: false, error: check.reason };
    if (!isEmailSendEnabled()) {
      return { ok: false, error: "EMAIL_SEND_ENABLED=false - envoi réel désactivé (dev/test/QA)." };
    }
    // Pas de client SMTP réel branché en P11 (aucune dépendance ajoutée -
    // cf. limites du rapport final) : ce fournisseur reste préparé mais
    // n'émet aucun appel réseau tant qu'une lib SMTP n'est pas décidée.
    return { ok: false, error: "SMTPEmailProvider : envoi réel non implémenté en P11 (abstraction préparée uniquement)." };
  }
}

/** Feature flag global (section 34) - Noop par défaut si absent, jamais d'envoi réel implicite. */
export function isEmailSendEnabled(): boolean {
  return process.env.EMAIL_SEND_ENABLED === "true";
}

let cachedProvider: EmailProvider | null = null;

/**
 * Sélectionne le fournisseur actif. Ne branche JAMAIS un fournisseur
 * externe arbitrairement (section 11) : NoopEmailProvider par défaut, sauf
 * configuration SMTP explicite ET EMAIL_SEND_ENABLED=true.
 */
export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider;
  if (isEmailSendEnabled() && process.env.SMTP_HOST) {
    cachedProvider = new SMTPEmailProvider({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
    });
  } else {
    cachedProvider = new NoopEmailProvider();
  }
  return cachedProvider;
}
