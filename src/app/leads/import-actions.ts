"use server";

import { revalidatePath } from "next/cache";
import { requireUserContext, hasPermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { parseLeadsCsv, type CsvLeadRow } from "@/lib/leads/csv-import";
import { findPotentialDuplicates } from "@/lib/leads/dedup";
import { createLeadFromSource } from "@/lib/leads/conversion";

// ============================================================
// Import CSV (P9, section 24) - aperçu obligatoire avant tout import
// (mapping colonnes, doublons potentiels, erreurs) : previewLeadsCsv() ne
// touche jamais la base. commitLeadsCsvImport() n'importe QUE les lignes
// explicitement confirmées par l'utilisateur - jamais une ligne invalide
// importée silencieusement (aucune ligne avec `errors.length > 0` n'est
// acceptée, même si elle est présente dans la liste envoyée).
// ============================================================

export type LeadCsvPreviewRow = CsvLeadRow & { doublonExistant: boolean };

export async function previewLeadsCsv(csvText: string): Promise<{ ok: true; rows: LeadCsvPreviewRow[]; unknownColumns: string[] } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "IMPORT_LEADS")) throw new Error("Accès refusé.");

    const { rows, unknownColumns } = parseLeadsCsv(csvText);
    const enriched: LeadCsvPreviewRow[] = [];
    for (const row of rows) {
      const duplicates = row.errors.length === 0 ? await findPotentialDuplicates({ organisationId: ctx.organisationId, telephone: row.telephone, email: row.email }) : [];
      enriched.push({ ...row, doublonExistant: duplicates.length > 0 });
    }

    return { ok: true, rows: enriched, unknownColumns };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

export async function commitLeadsCsvImport(rows: CsvLeadRow[]): Promise<{ ok: true; imported: number; skipped: number } | { ok: false; error: string }> {
  try {
    const ctx = await requireUserContext();
    if (!hasPermission(ctx, "IMPORT_LEADS")) throw new Error("Accès refusé.");

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.errors.length > 0 || !row.nom || !row.prenom) {
        skipped++;
        continue;
      }
      await createLeadFromSource({
        organisationId: ctx.organisationId,
        createdById: ctx.userId,
        sourceKey: row.source && (await isValidSourceKey(row.source)) ? row.source.toUpperCase() : "IMPORT",
        prenom: row.prenom,
        nom: row.nom,
        telephone: row.telephone,
        email: row.email,
        adresse: row.adresse,
        codePostal: row.codePostal,
        ville: row.ville,
        notes: row.commentaire,
      });
      imported++;
    }

    await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Lead", entityId: "import", action: "LEADS_IMPORTES", metadata: { imported, skipped } });

    revalidatePath("/leads");
    return { ok: true, imported, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

async function isValidSourceKey(key: string): Promise<boolean> {
  const found = await prisma.leadSource.findUnique({ where: { key: key.toUpperCase() } });
  return found != null;
}
