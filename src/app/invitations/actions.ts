"use server";

import { redirect } from "next/navigation";
import { acceptInvitation } from "@/lib/invitations/service";
import { getRateLimiter, RATE_LIMITS } from "@/lib/rate-limit";

export async function acceptInvitationAction(token: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await getRateLimiter().check(`invitation-accept:${token}`, RATE_LIMITS.INVITATION_ACCEPT.limit, RATE_LIMITS.INVITATION_ACCEPT.windowMs);
  if (!allowed) return { ok: false, error: "Trop de tentatives - réessayez plus tard." };
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { ok: false, error: "Les deux mots de passe ne correspondent pas." };

  const result = await acceptInvitation(token, name, password);
  if (!result.ok) return result;
  redirect("/login");
}
