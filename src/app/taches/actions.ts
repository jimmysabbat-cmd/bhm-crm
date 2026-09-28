"use server";

import { revalidatePath } from "next/cache";
import { requireInternalUserContext } from "@/lib/authz";
import { markRelanceDone, evaluateRelanceRules } from "@/lib/relances";

export async function marquerRelanceFaite(tacheId: string) {
  const ctx = await requireInternalUserContext();
  await markRelanceDone({ tacheId, organisationId: ctx.organisationId, userId: ctx.userId });
  revalidatePath("/taches");
}

export async function lancerEvaluationRelances() {
  const ctx = await requireInternalUserContext();
  await evaluateRelanceRules(ctx.organisationId);
  revalidatePath("/taches");
}
