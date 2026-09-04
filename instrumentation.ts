// Next.js appelle register() une seule fois au démarrage du serveur
// (runtime Node). P12 (section 3) : fail-fast en production si une
// variable d'environnement critique est absente/invalide - jamais un
// démarrage "silencieux" qui échouerait plus tard de façon confuse.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnvOrThrow } = await import("@/lib/env");
    assertEnvOrThrow();
  }
}
