import { auth } from "@/lib/auth";

// Rappel (cf. doc Next.js locale sur proxy.js) : le garde d'accès au niveau
// routeur ne couvre pas forcément chaque Server Function si son point
// d'entrée change - chaque Server Action doit donc vérifier sa propre
// session, indépendamment de src/proxy.ts.
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Non autorisé : session requise.");
  }
  return session;
}
