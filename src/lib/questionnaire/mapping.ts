import type { TypeTravaux, ZoneClimatique, Precarite } from "@/generated/prisma/enums";

// ============================================================
// Mapping des réponses vers les champs métier (P9, section 10). Le
// questionnaire est une interface de collecte : une réponse importante ne
// doit jamais rester uniquement dans le JSON de ReponseQuestion. La
// convention `champMappe` ("Logement.surfaceChauffeeM2",
// "Projet.typeTravauxSouhaite") est documentée ici et nulle part ailleurs -
// un seul endroit à lire pour savoir comment une question alimente le
// modèle métier. Les moteurs P7/P8 continuent de lire Dossier/
// DossierPosteTravaux, jamais le questionnaire directement.
// ============================================================

export type LogementFieldUpdate = Partial<{
  typeBatiment: "MAISON" | "APPARTEMENT";
  typeHabitat: "INDIVIDUEL" | "COLLECTIF";
  anneeConstruction: number;
  surfaceHabitableM2: number;
  surfaceChauffeeM2: number;
  nombreNiveaux: number;
  nombreLogements: number;
  chauffagePrincipal: "ELECTRICITE" | "GAZ" | "FIOUL" | "BOIS" | "PAC" | "RESEAU_CHALEUR" | "AUTRE";
  equipementChauffage: string;
  anneeEquipementChauffage: number;
  ecs: boolean;
  energieEcs: "ELECTRICITE" | "GAZ" | "FIOUL" | "BOIS" | "PAC" | "RESEAU_CHALEUR" | "AUTRE";
  climatisation: boolean;
  dpe: string;
  consommationAnnuelleKwh: number;
  isolationMurs: string;
  isolationCombles: string;
  isolationRampants: string;
  isolationPlancherBas: string;
  isolationFenetres: string;
}>;

type FieldKind = "float" | "int" | "string" | "boolean" | "enum";

const LOGEMENT_FIELD_KIND: Record<keyof LogementFieldUpdate, FieldKind> = {
  typeBatiment: "enum",
  typeHabitat: "enum",
  anneeConstruction: "int",
  surfaceHabitableM2: "float",
  surfaceChauffeeM2: "float",
  nombreNiveaux: "int",
  nombreLogements: "int",
  chauffagePrincipal: "enum",
  equipementChauffage: "string",
  anneeEquipementChauffage: "int",
  ecs: "boolean",
  energieEcs: "enum",
  climatisation: "boolean",
  dpe: "string",
  consommationAnnuelleKwh: "int",
  isolationMurs: "string",
  isolationCombles: "string",
  isolationRampants: "string",
  isolationPlancherBas: "string",
  isolationFenetres: "string",
};

export type MappableAnswer = {
  code: string;
  champMappe: string | null;
  valeurTexte: string | null;
  valeurNombre: number | null;
  valeurBool: boolean | null;
  valeurOptions: string[] | null;
};

export type ClientFieldUpdate = Partial<{
  zoneClimatique: ZoneClimatique;
  precarite: Precarite;
}>;

const CLIENT_FIELD_KIND: Record<keyof ClientFieldUpdate, FieldKind> = {
  zoneClimatique: "enum",
  precarite: "enum",
};

export type MapReponsesResult = {
  logement: LogementFieldUpdate;
  client: ClientFieldUpdate;
  projetTypeTravaux: TypeTravaux | null;
  unmapped: string[];
};

export function mapReponsesToStructuredFields(reponses: MappableAnswer[]): MapReponsesResult {
  const logement: Record<string, string | number | boolean> = {};
  const client: Record<string, string> = {};
  let projetTypeTravaux: TypeTravaux | null = null;
  const unmapped: string[] = [];

  for (const r of reponses) {
    if (!r.champMappe) {
      unmapped.push(r.code);
      continue;
    }
    if (r.champMappe === "Projet.typeTravauxSouhaite") {
      const code = r.valeurOptions?.[0] ?? r.valeurTexte;
      if (code) projetTypeTravaux = code as TypeTravaux;
      continue;
    }
    const clientMatch = r.champMappe.match(/^Client\.(.+)$/);
    if (clientMatch) {
      const field = clientMatch[1] as keyof ClientFieldUpdate;
      if (CLIENT_FIELD_KIND[field]) {
        const v = r.valeurOptions?.[0] ?? r.valeurTexte;
        if (v) client[field] = v;
      } else {
        unmapped.push(r.code);
      }
      continue;
    }
    const match = r.champMappe.match(/^Logement\.(.+)$/);
    const field = match?.[1];
    const kind = field ? LOGEMENT_FIELD_KIND[field as keyof LogementFieldUpdate] : undefined;
    if (!field || !kind) {
      unmapped.push(r.code);
      continue;
    }
    switch (kind) {
      case "float":
        if (r.valeurNombre != null) logement[field] = r.valeurNombre;
        break;
      case "int":
        if (r.valeurNombre != null) logement[field] = Math.round(r.valeurNombre);
        break;
      case "string":
        if (r.valeurTexte) logement[field] = r.valeurTexte;
        else if (r.valeurOptions?.[0]) logement[field] = r.valeurOptions[0];
        break;
      case "boolean":
        if (r.valeurBool != null) logement[field] = r.valeurBool;
        break;
      case "enum": {
        const v = r.valeurOptions?.[0] ?? r.valeurTexte;
        if (v) logement[field] = v;
        break;
      }
    }
  }

  return { logement: logement as LogementFieldUpdate, client: client as ClientFieldUpdate, projetTypeTravaux, unmapped };
}
