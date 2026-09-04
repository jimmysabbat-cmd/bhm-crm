import { NextResponse } from "next/server";
import { runScheduledAutomations } from "@/lib/automations/scheduler";

// ============================================================
// Route interne protégée (P11, section 17) - déclenche le scheduler par
// HTTP en alternative au CLI (npm run automations:run), pour un futur
// déclencheur externe (cron système, service de ping). JAMAIS publique :
// protection stricte par secret serveur transmis en en-tête, comparé à
// AUTOMATIONS_INTERNAL_SECRET. Si le secret serveur n'est pas configuré,
// la route refuse TOUJOURS (fail-closed), jamais un accès non protégé par
// défaut.
// ============================================================

export async function POST(request: Request) {
  const expected = process.env.AUTOMATIONS_INTERNAL_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Route désactivée : AUTOMATIONS_INTERNAL_SECRET non configuré." }, { status: 503 });
  }

  const provided = request.headers.get("x-internal-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  const summary = await runScheduledAutomations(new Date(), dryRun);
  const totals = summary.rules.reduce(
    (acc, r) => ({ matched: acc.matched + r.matched, executed: acc.executed + r.executed, skipped: acc.skipped + r.skipped, errors: acc.errors + r.errors }),
    { matched: 0, executed: 0, skipped: 0, errors: 0 }
  );

  return NextResponse.json({ startedAt: summary.startedAt, dryRun: summary.dryRun, totals, rules: summary.rules });
}
