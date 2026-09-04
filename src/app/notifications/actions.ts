"use server";

import { revalidatePath } from "next/cache";
import { requireUserContext } from "@/lib/authz";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications/service";

export async function markRead(notificationId: string) {
  const ctx = await requireUserContext();
  await markNotificationRead(notificationId, ctx.userId);
  revalidatePath("/notifications");
}

export async function markAllRead() {
  const ctx = await requireUserContext();
  await markAllNotificationsRead(ctx.userId);
  revalidatePath("/notifications");
}
