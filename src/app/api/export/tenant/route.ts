import { NextResponse } from "next/server";
import { requireUserContext } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getTenantExportData, flattenForCsv, toCsv } from "@/lib/platform/export";

// ============================================================
// Export basique tenant (P12, section 48) - réservé ADMIN de SON
// organisation (jamais d'accès inter-tenant, ctx.organisationId vient
// exclusivement de requireUserContext()).
// ============================================================

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }
  if (ctx.role !== "ADMIN") {
    return new NextResponse("Accès refusé", { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await getTenantExportData(ctx.organisationId);

  await logAudit({ organisationId: ctx.organisationId, userId: ctx.userId, entityType: "Organisation", entityId: ctx.organisationId, action: "EXPORT_TENANT_DATA", metadata: { format, nbClients: data.clients.length, nbLeads: data.leads.length, nbDossiers: data.dossiers.length } });

  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="export-${ctx.organisationId}.json"` },
    });
  }

  const flat = flattenForCsv(data);
  const parts = [`# CLIENTS\n${toCsv(flat.clients)}`, `\n\n# LEADS\n${toCsv(flat.leads)}`, `\n\n# DOSSIERS\n${toCsv(flat.dossiers)}`];
  return new NextResponse(parts.join(""), {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="export-${ctx.organisationId}.csv"` },
  });
}
