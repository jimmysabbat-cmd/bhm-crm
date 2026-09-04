"use server";

import { redirect } from "next/navigation";
import { resetPasswordWithToken } from "@/lib/invitations/service";

export async function resetPasswordAction(token: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { ok: false, error: "Les deux mots de passe ne correspondent pas." };

  const result = await resetPasswordWithToken(token, password);
  if (!result.ok) return result;
  redirect("/login");
}
