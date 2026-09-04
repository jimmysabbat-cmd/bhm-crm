import { prisma } from "@/lib/prisma";

// ============================================================
// Export basique tenant (P12, section 48) - CSV/JSON raisonnable pour
// clients/leads/dossiers, réservé à un admin de SON tenant. Pas de
// documents (hors périmètre P12).
// ============================================================

export async function getTenantExportData(organisationId: string) {
  const [clients, leads, dossiers] = await Promise.all([
    prisma.client.findMany({ where: { organisationId }, select: { id: true, prenom: true, nom: true, email: true, telephone: true, adresse: true, codePostal: true, ville: true, createdAt: true } }),
    prisma.lead.findMany({ where: { organisationId }, select: { id: true, prenom: true, nom: true, email: true, telephone: true, statut: { select: { label: true } }, source: { select: { label: true } }, createdAt: true } }),
    prisma.dossier.findMany({ where: { organisationId }, select: { id: true, reference: true, client: { select: { prenom: true, nom: true } }, type: { select: { label: true } }, statut: { select: { label: true } }, montantDevisTTC: true, createdAt: true } }),
  ]);
  return { clients, leads, dossiers };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

export function flattenForCsv(data: Awaited<ReturnType<typeof getTenantExportData>>) {
  return {
    clients: data.clients.map((c) => ({ id: c.id, prenom: c.prenom, nom: c.nom, email: c.email, telephone: c.telephone, adresse: c.adresse, codePostal: c.codePostal, ville: c.ville, createdAt: c.createdAt.toISOString() })),
    leads: data.leads.map((l) => ({ id: l.id, prenom: l.prenom, nom: l.nom, email: l.email, telephone: l.telephone, statut: l.statut.label, source: l.source?.label ?? "", createdAt: l.createdAt.toISOString() })),
    dossiers: data.dossiers.map((d) => ({ id: d.id, reference: d.reference, client: `${d.client.prenom} ${d.client.nom}`, type: d.type.label, statut: d.statut.label, montantDevisTTC: (d.montantDevisTTC / 100).toFixed(2), createdAt: d.createdAt.toISOString() })),
  };
}

export { toCsv };
