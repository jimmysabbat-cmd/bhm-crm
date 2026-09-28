import { NextResponse } from "next/server";
import { requireUserContext, hasPermission, isPartnerRole } from "@/lib/authz";
import { getLignesTresorerie, contrepartieTypeLabels } from "@/lib/tresorerie";

// Export CSV (séparateur « ; », décimales à virgule : ouvre directement dans
// Excel FR) de toutes les lignes en attente de l'échéancier de trésorerie.
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireUserContext();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }
  if (isPartnerRole(ctx) || !hasPermission(ctx, "VIEW_FINANCIAL_SUMMARY")) return new NextResponse("Accès refusé", { status: 403 });
  const voitSorties = hasPermission(ctx, "VIEW_INTERNAL_COSTS");
  const type = new URL(request.url).searchParams.get("type");

  const lignes = (await getLignesTresorerie(ctx.organisationId))
    .filter((l) => voitSorties || l.sens === "ENTREE")
    .filter((l) => !type || l.cpType === type)
    .sort((a, b) => (a.echeance?.getTime() ?? Infinity) - (b.echeance?.getTime() ?? Infinity));

  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const eur = (cts: number) => (cts / 100).toFixed(2).replace(".", ",");
  const header = ["Sens", "Type contrepartie", "Contrepartie", "Dossier", "Client", "Nature", "Échéance", "Échéance estimée", "En retard (jours)", "Prévu (€)", "Déjà réglé (€)", "Reste dû (€)", "Statut", "Origine"];
  const rows = lignes.map((l) =>
    [
      l.sens === "ENTREE" ? "À encaisser" : "À décaisser",
      contrepartieTypeLabels[l.cpType],
      l.cpNom,
      l.dossierReference,
      l.clientLabel,
      l.categorieLabel,
      l.echeance ? l.echeance.toLocaleDateString("fr-FR") : "",
      l.echeance && l.echeanceEstimee ? "oui" : "",
      l.enRetard ? String(l.joursRetard) : "",
      eur(l.prevuCts),
      eur(l.reelCts),
      eur(l.resteCts),
      l.statutLabel,
      l.virtuelle ? "Prévu d'après le dossier" : "Mouvement",
    ]
      .map(esc)
      .join(";")
  );
  const csv = "﻿" + [header.join(";"), ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tresorerie-${date}.csv"`,
    },
  });
}
