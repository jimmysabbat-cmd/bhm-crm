import type { NextConfig } from "next";

// P12 (section 31) - headers de sécurité raisonnables, sans casser Next.js
// (App Router utilise des scripts/styles inline générés au build - une CSP
// stricte sans 'unsafe-inline' sur script-src casserait le hot-reload dev
// et certains mécanismes internes ; on documente ce compromis plutôt que
// de prétendre à une CSP parfaite non testée).
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' en dev uniquement : React Refresh/webpack dev évaluent
      // du code, sans quoi aucune page ne s'hydrate en local (boutons inertes).
      isProduction ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // P12 - hébergement mutualisé o2switch : `os.cpus()` y rapporte le nombre
  // de coeurs de la machine hôte partagée (ex. 47), pas les ressources
  // réellement allouées, ce qui faisait planter "Collecting page data"
  // (SIGABRT) faute de mémoire. On borne donc explicitement la concurrence.
  experimental: {
    // Portail donneur d'ordre / documents : plusieurs photos + PDF par
    // envoi. Au-delà de la limite par défaut (1 Mo) la Server Action
    // levait une exception non rattrapée côté formulaire.
    serverActions: { bodySizeLimit: "30mb" },
    cpus: 2,
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 2,
    staticGenerationMinPagesPerWorker: 25,
  },
};

export default nextConfig;
