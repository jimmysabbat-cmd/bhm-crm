import type { Precarite, TypeTravaux } from "@/generated/prisma/enums";

// Barèmes MaPrimeRénov' "par geste" (monogeste), maison individuelle,
// propriétaires occupants. Trois éditions du guide ANAH comparées :
// - mars 2025 : barème au 1er janvier 2025
// - février 2026 : barème au 1er janvier 2026 (isolation des murs et
//   chaudières biomasse retirées du dispositif à partir du 01/01/2026)
// - septembre 2026 : même barème que février 2026, mais liste
//   d'équipements éligibles réduite au chauffage décarboné uniquement
//   à partir du 01/09/2026 (plus aucune isolation, plus de solaire/bois)
//
// "Ménages aux revenus supérieurs" = non éligible sur tous les gestes,
// dans les trois éditions — categorie volontairement absente ci-dessous.

export type UniteForfait = "fixe" | "m2" | "equipement";

type GesteBareme = {
  unite: UniteForfait;
  montantsCts: Partial<Record<Precarite, number>>;
};

type Bareme = Partial<Record<TypeTravaux, GesteBareme>>;

const c = (euros: number) => euros * 100;

// Barème identique pour la plupart des gestes entre les 3 éditions ; on le
// factorise et on retire simplement ce qui n'est plus éligible à chaque palier.
const CHAUFFAGE_BASE: Bareme = {
  RACCORDEMENT_RESEAU_CHALEUR: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1200), MODESTE: c(800), INTERMEDIAIRE: c(400) } },
  CHAUFFE_EAU_THERMODYNAMIQUE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1200), MODESTE: c(800), INTERMEDIAIRE: c(400) } },
  BALLON_THERMODYNAMIQUE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1200), MODESTE: c(800), INTERMEDIAIRE: c(400) } },
  PAC_AIR_EAU: { unite: "fixe", montantsCts: { TRES_MODESTE: c(5000), MODESTE: c(4000), INTERMEDIAIRE: c(3000) } },
  PAC_GEOTHERMIQUE_SOLAROTHERMIQUE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(11000), MODESTE: c(9000), INTERMEDIAIRE: c(6000) } },
  CHAUFFE_EAU_SOLAIRE_INDIVIDUEL: { unite: "fixe", montantsCts: { TRES_MODESTE: c(4000), MODESTE: c(3000), INTERMEDIAIRE: c(2000) } },
  CHAUFFAGE_SOLAIRE_COMBINE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(10000), MODESTE: c(8000), INTERMEDIAIRE: c(4000) } },
  PVT_EAU: { unite: "fixe", montantsCts: { TRES_MODESTE: c(2500), MODESTE: c(2000), INTERMEDIAIRE: c(1000) } },
  POELE_BUCHES: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1250), MODESTE: c(1000), INTERMEDIAIRE: c(500) } },
  POELE_GRANULES: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1250), MODESTE: c(1000), INTERMEDIAIRE: c(750) } },
  FOYER_FERME_INSERT: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1250), MODESTE: c(750), INTERMEDIAIRE: c(500) } },
};

const ISOLATION_BASE: Bareme = {
  COMBLES: { unite: "m2", montantsCts: { TRES_MODESTE: c(25), MODESTE: c(20), INTERMEDIAIRE: c(15) } },
  RAMPANTS: { unite: "m2", montantsCts: { TRES_MODESTE: c(25), MODESTE: c(20), INTERMEDIAIRE: c(15) } },
  TOITURE_TERRASSE: { unite: "m2", montantsCts: { TRES_MODESTE: c(75), MODESTE: c(60), INTERMEDIAIRE: c(40) } },
  PAROIS_VITREES: { unite: "equipement", montantsCts: { TRES_MODESTE: c(100), MODESTE: c(80), INTERMEDIAIRE: c(40) } },
};

const AUTRES_BASE: Bareme = {
  AUDIT_ENERGETIQUE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(500), MODESTE: c(400), INTERMEDIAIRE: c(300) } },
  DEPOSE_CUVE_FIOUL: { unite: "fixe", montantsCts: { TRES_MODESTE: c(1200), MODESTE: c(800), INTERMEDIAIRE: c(400) } },
  VMC: { unite: "fixe", montantsCts: { TRES_MODESTE: c(2500), MODESTE: c(2000), INTERMEDIAIRE: c(1500) } },
};

// Avant le 01/01/2026 (guide ANAH mars 2025, p.16-17) — isolation des murs et
// chaudières biomasse encore financées.
export const BAREME_AVANT_2026: Bareme = {
  ...CHAUFFAGE_BASE,
  CHAUDIERE_BOIS_MANUELLE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(3750), MODESTE: c(3150), INTERMEDIAIRE: c(1400) } },
  CHAUDIERE_BOIS_AUTOMATIQUE: { unite: "fixe", montantsCts: { TRES_MODESTE: c(5000), MODESTE: c(3850), INTERMEDIAIRE: c(2100) } },
  ITE: { unite: "m2", montantsCts: { TRES_MODESTE: c(75), MODESTE: c(60), INTERMEDIAIRE: c(40) } },
  ITI: { unite: "m2", montantsCts: { TRES_MODESTE: c(25), MODESTE: c(20), INTERMEDIAIRE: c(15) } },
  ...ISOLATION_BASE,
  ...AUTRES_BASE,
};

// À partir du 01/01/2026 (guide ANAH février 2026, p.14-17) — isolation des
// murs (ITE/ITI) et chaudières biomasse retirées du dispositif.
export const BAREME_2026_JANVIER: Bareme = {
  ...CHAUFFAGE_BASE,
  ...ISOLATION_BASE,
  ...AUTRES_BASE,
};

// À partir du 01/09/2026 (guide ANAH septembre 2026, p.13-16) — seul le
// chauffage décarboné (réseau de chaleur, PAC) reste financé ; toute
// isolation et tout chauffage bois/solaire sortent du dispositif.
export const BAREME_2026_SEPTEMBRE: Bareme = {
  RACCORDEMENT_RESEAU_CHALEUR: CHAUFFAGE_BASE.RACCORDEMENT_RESEAU_CHALEUR,
  PAC_AIR_EAU: CHAUFFAGE_BASE.PAC_AIR_EAU,
  PAC_GEOTHERMIQUE_SOLAROTHERMIQUE: CHAUFFAGE_BASE.PAC_GEOTHERMIQUE_SOLAROTHERMIQUE,
  AUDIT_ENERGETIQUE: AUTRES_BASE.AUDIT_ENERGETIQUE,
  DEPOSE_CUVE_FIOUL: AUTRES_BASE.DEPOSE_CUVE_FIOUL,
};

export function bareme(dateDepot: string): Bareme {
  if (!dateDepot) return BAREME_2026_SEPTEMBRE;
  if (dateDepot < "2026-01-01") return BAREME_AVANT_2026;
  if (dateDepot < "2026-09-01") return BAREME_2026_JANVIER;
  return BAREME_2026_SEPTEMBRE;
}

export function baremeLabel(dateDepot: string): string {
  if (!dateDepot || dateDepot >= "2026-09-01") return "depuis le 01/09/2026 (chauffage décarboné uniquement)";
  if (dateDepot >= "2026-01-01") return "01/01/2026 – 31/08/2026 (isolation des murs retirée)";
  return "avant le 01/01/2026";
}

export function gesteMontantCts(
  dateDepot: string,
  type: TypeTravaux,
  precarite: Precarite,
  quantite: number
): number | null {
  const geste = bareme(dateDepot)[type];
  if (!geste) return null;
  const taux = geste.montantsCts[precarite];
  if (taux === undefined) return null;
  return geste.unite === "fixe" ? taux : Math.round(taux * quantite);
}
