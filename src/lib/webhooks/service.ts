import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

// ============================================================
// Webhooks sortants (P11, sections 26-29) - pas d'API publique entrante.
// Signature HMAC (section 27), retry borné (section 28, 3 tentatives max,
// backoff simple), jamais d'appel réseau réel en dev/test/QA tant que
// WEBHOOK_SEND_ENABLED n'est pas explicitement activé (section 34/35).
// ============================================================

export const DOMAIN_EVENTS = [
  "LEAD_CREATED",
  "LEAD_CONVERTED",
  "DOSSIER_SIGNED",
  "DOCUMENT_VALIDATED",
  "PACKAGE_READY",
  "CEE_VALUED",
  "PAYMENT_RECEIVED",
] as const;

export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

const MAX_ATTEMPTS = 3;

export function isWebhookSendEnabled(): boolean {
  return process.env.WEBHOOK_SEND_ENABLED === "true";
}

/** Signature HMAC-SHA256 du payload JSON exact envoyé - jamais le secret en clair dans les logs. */
export function signWebhookPayload(secret: string, payloadJson: string): string {
  return createHmac("sha256", secret).update(payloadJson).digest("hex");
}

/**
 * emitDomainEvent (section 29) - couche interne légère : ne transforme pas
 * l'application en architecture événementielle complexe, juste un point
 * d'appel explicite à ajouter aux endroits pertinents (ex. après le
 * passage d'un package en PRET) qui relaie l'événement à tous les
 * WebhookEndpoint actifs de l'organisation abonnés à ce type d'événement.
 * Le moteur d'automation (actions.ts, action WEBHOOK_OUTGOING) peut aussi
 * appeler deliverToEndpoint directement pour un endpoint précis.
 */
export async function emitDomainEvent(organisationId: string, event: DomainEvent, payload: Record<string, unknown>): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { organisationId, actif: true } });
  for (const endpoint of endpoints) {
    const eventTypes = Array.isArray(endpoint.eventTypes) ? (endpoint.eventTypes as string[]) : [];
    if (!eventTypes.includes(event)) continue;
    await deliverToEndpoint(endpoint.id, organisationId, event, payload);
  }
}

/**
 * Crée une WebhookDelivery et tente l'envoi si WEBHOOK_SEND_ENABLED=true ;
 * sinon reste EN_ATTENTE (préparée, jamais émise) - cohérent avec le mode
 * PREPARE_ONLY et avec "pas d'envoi réel en QA" (section 35).
 */
export async function deliverToEndpoint(
  endpointId: string,
  organisationId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<{ id: string; sent: boolean }> {
  const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id: endpointId, organisationId } });

  const delivery = await prisma.webhookDelivery.create({
    data: { endpointId: endpoint.id, organisationId, event, payload: payload as never, attempts: 0, statut: "EN_ATTENTE" },
  });

  if (!isWebhookSendEnabled()) {
    // Préparé mais jamais émis (WEBHOOK_SEND_ENABLED=false) - pas d'audit
    // ici : action système sans acteur humain, cf. logAudit (AuditLog.userId
    // est une FK obligatoire, jamais un id fictif).
    return { id: delivery.id, sent: false };
  }

  const sent = await attemptDelivery(delivery.id, endpoint.id, organisationId);
  return { id: delivery.id, sent };
}

/** Tente l'envoi jusqu'à MAX_ATTEMPTS fois avec un backoff simple (jamais de boucle infinie). */
async function attemptDelivery(deliveryId: string, endpointId: string, organisationId: string): Promise<boolean> {
  const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id: endpointId, organisationId } });
  const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { id: deliveryId, organisationId } });
  const payloadJson = JSON.stringify(delivery.payload);
  const signature = signWebhookPayload(endpoint.secret, payloadJson);

  for (let attempt = delivery.attempts + 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BHM-Signature": signature },
        body: payloadJson,
      });
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { attempts: attempt, responseStatus: response.status, statut: response.ok ? "ENVOYE" : "ECHEC", error: response.ok ? null : `HTTP ${response.status}` },
      });
      if (response.ok) return true;
    } catch (e) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { attempts: attempt, statut: "ECHEC", error: e instanceof Error ? e.message : "Erreur réseau." },
      });
    }
    if (attempt < MAX_ATTEMPTS) await sleepBackoff(attempt);
  }
  return false;
}

function sleepBackoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 200));
}
