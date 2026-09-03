import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Journal d'audit minimal - ne jamais y écrire de mot de passe, secret ou
// contenu sensible ; metadata reste un résumé (ex. libellé, dossierId),
// jamais un dump complet de l'entité.
export async function logAudit(params: {
  organisationId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await prisma.auditLog.create({
    data: {
      organisationId: params.organisationId,
      userId: params.userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
