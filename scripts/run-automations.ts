import "dotenv/config";
import { runScheduledAutomations } from "../src/lib/automations/scheduler";

// ============================================================
// CLI (P11, section 17) - npm run automations:run. Ne dépend pas d'un cron
// cloud externe : à appeler manuellement, via une tâche planifiée du
// système hôte, ou via /api/internal/automations/run (protégée par
// secret). --dry-run simule sans effet réel (section 20).
// ============================================================

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const summary = await runScheduledAutomations(now, dryRun);

  console.log(`Scheduler exécuté à ${summary.startedAt.toISOString()}${dryRun ? " (DRY RUN)" : ""}`);
  for (const rule of summary.rules) {
    console.log(`  ${rule.ruleCode} : ${rule.matched} match(es), ${rule.executed} exécutée(s), ${rule.skipped} ignorée(s), ${rule.errors} erreur(s)`);
  }
  const totals = summary.rules.reduce(
    (acc, r) => ({ matched: acc.matched + r.matched, executed: acc.executed + r.executed, skipped: acc.skipped + r.skipped, errors: acc.errors + r.errors }),
    { matched: 0, executed: 0, skipped: 0, errors: 0 }
  );
  console.log(`Total : ${totals.matched} match(es), ${totals.executed} exécutée(s), ${totals.skipped} ignorée(s), ${totals.errors} erreur(s)`);
  process.exitCode = totals.errors > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
