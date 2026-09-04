import { prisma } from "@/lib/prisma";

// ============================================================
// Notifications internes (P11, sections 14/15) - centre simple,
// rafraîchissement page standard, pas de websocket.
// ============================================================

export async function createNotification(params: {
  userId: string;
  organisationId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<string> {
  const notif = await prisma.notification.create({
    data: {
      userId: params.userId,
      organisationId: params.organisationId,
      type: params.type,
      title: params.title,
      message: params.message,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
    },
  });
  return notif.id;
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function getNotificationsForUser(userId: string, limit = 50) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
