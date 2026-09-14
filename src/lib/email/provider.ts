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
 * SMTP générique (P16) - configurable UNIQUEMENT via variables
 * d'environnement (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM/
 * SMTP_SECURE), AUCUN secret en dur dans le code. N'effectue un envoi réel
 * QUE si EMAIL_SEND_ENABLED=true (section 34) - sinon se comporte comme
 * NoopEmailProvider pour rester sûr par défaut en dev/QA (section 35).
 * Le transport nodemailer est créé paresseusement (une seule fois, jamais
 * à chaque envoi) et jamais si l'envoi réel est désactivé.
 */
export class SMTPEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transporter: import("nodemailer").Transporter | null = null;

  constructor(
    private readonly config: {
      host: string | undefined;
      port: number | undefined;
      user: string | undefined;
      pass: string | undefined;
      from: string | undefined;
      secure: boolean;
    }
  ) {}

  validateConfiguration(): { valid: boolean; reason?: string } {
    if (!this.config.host || !this.config.port || !this.config.from) {
      return { valid: false, reason: "SMTP_HOST/SMTP_PORT/SMTP_FROM manquant(s) - configuration incomplète." };
    }
    return { valid: true };
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const check = this.validateConfiguration();
    if (!check.valid) return { ok: false, error: check.reason };
    if (!isEmailSendEnabled()) {
      return { ok: false, error: "EMAIL_SEND_ENABLED=false - envoi réel désactivé (dev/test/QA)." };
    }

    try {
      if (!this.transporter) {
        const nodemailer = await import("nodemailer");
        this.transporter = nodemailer.createTransport({
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined,
        });
      }
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: params.to,
        subject: params.subject,
        text: params.body,
      });
      return { ok: true, providerMessageId: info.messageId };
    } catch (e) {
      // Jamais de mot de passe/secret dans le message d'erreur journalisé -
      // seul le message d'erreur nodemailer (protocole SMTP) est propagé.
      return { ok: false, error: e instanceof Error ? e.message : "Erreur SMTP inconnue." };
    }
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
      pass: process.env.SMTP_PASSWORD,
      from: process.env.SMTP_FROM,
      secure: process.env.SMTP_SECURE === "true",
    });
  } else {
    cachedProvider = new NoopEmailProvider();
  }
  return cachedProvider;
}

/** Réservé aux tests - force le prochain getEmailProvider() à recréer le fournisseur (ex. après changement d'env). */
export function resetEmailProviderCache(): void {
  cachedProvider = null;
}
