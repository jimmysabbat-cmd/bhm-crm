import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { validateEnv } from "../src/lib/env";

// ============================================================
// npm run production:check (P12, section 50) - READY/NOT_READY avec
// raisons, SANS jamais afficher de valeur de secret (uniquement le nom de
// la variable manquante/invalide).
// ============================================================

type CheckResult = { label: string; ok: boolean; detail: string };

async function main() {
  const results: CheckResult[] = [];
  const nodeEnv = process.env.NODE_ENV ?? "development";
  results.push({ label: "NODE_ENV", ok: nodeEnv === "production", detail: nodeEnv });

  const envIssues = validateEnv("production");
  const critical = envIssues.filter((i) => i.severity === "CRITICAL");
  results.push({ label: "Variables critiques", ok: critical.length === 0, detail: critical.length === 0 ? "OK" : critical.map((i) => i.variable).join(", ") });
  const warnings = envIssues.filter((i) => i.severity === "WARNING");
  for (const w of warnings) {
    results.push({ label: `Config recommandée : ${w.variable}`, ok: true, detail: "non configuré (fonctionnalité restera désactivée/Noop - pas bloquant)" });
  }

  try {
    await prisma.organisation.count();
    results.push({ label: "Connexion base de données", ok: true, detail: "OK" });
  } catch (e) {
    results.push({ label: "Connexion base de données", ok: false, detail: e instanceof Error ? e.message : "échec de connexion" });
  }

  // Sanity check migrations : les tables P12 (les plus récentes) doivent
  // exister - un proxy simple pour "le schéma est bien à jour" sans
  // dépendre d'un historique de migrations formel (cf. LIMITES du rapport).
  try {
    await prisma.userInvitation.count();
    await prisma.passwordResetToken.count();
    results.push({ label: "Schéma à jour (tables P12 présentes)", ok: true, detail: "OK" });
  } catch {
    results.push({ label: "Schéma à jour (tables P12 présentes)", ok: false, detail: "tables manquantes - migrations non appliquées" });
  }

  const superAdmin = await prisma.user.findFirst({ where: { isPlatformSuperAdmin: true }, select: { id: true } }).catch(() => null);
  results.push({ label: "Platform Super Admin existant", ok: !!superAdmin, detail: superAdmin ? "OK" : "aucun - lancer npm run platform:create-admin" });

  const qaAccount = await prisma.user.findFirst({ where: { email: "test-qa-local@bhm-crm.local" } }).catch(() => null);
  results.push({ label: "Absence du compte QA local", ok: !qaAccount, detail: qaAccount ? "PRÉSENT - ne doit jamais exister en production" : "OK" });

  const fixtureOrgs = await prisma.organisation.count({ where: { nom: { startsWith: "Test " } } }).catch(() => 0);
  results.push({ label: "Absence d'organisations de test (fixtures)", ok: fixtureOrgs === 0, detail: fixtureOrgs === 0 ? "OK" : `${fixtureOrgs} trouvée(s)` });

  const storageProvider = process.env.STORAGE_PROVIDER ?? "local";
  results.push({ label: "Stockage documents", ok: true, detail: storageProvider === "local" ? "local (BLOCKER si hébergement serverless/éphémère - cf. rapport)" : storageProvider });

  console.log("\n=== Production Readiness Check ===\n");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.label} : ${r.detail}`);
  }

  const ready = results.every((r) => r.ok);
  console.log(`\n${ready ? "READY" : "NOT_READY"}`);
  process.exitCode = ready ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
