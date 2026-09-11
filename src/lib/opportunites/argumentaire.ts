import { renderTemplate, type TemplateVariables } from "@/lib/automations/templates";
import type { OpportuniteDetectee } from "./types";

// ============================================================
// Rendu de l'argumentaire commercial (P14, audit section K/13). Réutilise
// EXACTEMENT le moteur de substitution de variables whitelistées déjà
// utilisé par EmailTemplate (jamais d'interpolation arbitraire). Le bloc
// AIDES n'existe PAS comme template ici : il est toujours généré à partir
// de l'OpportuniteDetectee elle-même (programmesATester/
// reglesReglementairesATester), jamais d'un texte libre tenant - un
// argumentaire ne peut donc structurellement jamais fabriquer un montant,
// une éligibilité ou une économie.
// ============================================================

export type ArgumentaireBlocs = {
  pourquoi: string | null;
  benefices: string | null;
  aConfirmer: string | null;
  prochaineEtape: string | null;
  aides: string; // TOUJOURS généré, jamais un template tenant.
};

function renderBlock(template: string | null, variables: TemplateVariables): string | null {
  if (!template) return null;
  try {
    return renderTemplate(template, variables);
  } catch {
    // Une variable non whitelistée dans un template mal configuré ne doit
    // jamais faire planter l'écran télépro - retourne le template brut
    // plutôt qu'une exception, l'admin doit corriger via Paramétrage.
    return template;
  }
}

function renderAidesBlock(opportunite: OpportuniteDetectee): string {
  const lignes: string[] = [];
  if (opportunite.programmesATester.length > 0) {
    lignes.push(`Programmes potentiellement applicables (à confirmer) : ${opportunite.programmesATester.map((p) => p.nom).join(", ")}.`);
  }
  if (opportunite.reglesReglementairesATester.length > 0) {
    lignes.push(`Dispositifs CEE/réglementaires à tester : ${opportunite.reglesReglementairesATester.map((r) => r.code).join(", ")}.`);
  }
  if (lignes.length === 0) {
    lignes.push("Aides potentielles à déterminer - aucun programme ni règle réglementaire configuré pour ce métier.");
  }
  lignes.push(`Statut d'éligibilité potentielle : ${opportunite.statutEligibilitePotentielle} (jamais garanti à ce stade).`);
  return lignes.join("\n");
}

export function renderArgumentaireBlocs(params: {
  templates: { pourquoi: string | null; benefices: string | null; aConfirmer: string | null; prochaineEtape: string | null };
  opportunite: OpportuniteDetectee;
  variables: TemplateVariables;
}): ArgumentaireBlocs {
  return {
    pourquoi: renderBlock(params.templates.pourquoi, params.variables),
    benefices: renderBlock(params.templates.benefices, params.variables),
    aConfirmer: renderBlock(params.templates.aConfirmer, params.variables),
    prochaineEtape: renderBlock(params.templates.prochaineEtape, params.variables),
    aides: renderAidesBlock(params.opportunite),
  };
}
