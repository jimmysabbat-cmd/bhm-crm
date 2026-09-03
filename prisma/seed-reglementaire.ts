import { PrismaClient } from "../src/generated/prisma/client";

// Table cumac EXACTEMENT recopiée depuis l'ancien calculateur
// (src/components/ui/CeeCumacCalculator.tsx) - fiche BAR-TH-171 (PAC
// air/eau), barème "Eco Environnement - Eco Negoce", entrée en vigueur le
// 01/01/2026. Aucune valeur n'est inventée ni modifiée (section 34 du
// prompt P7) : ce seed déplace la table existante vers BaremeReglementaire
// sans y toucher, pour que le nouveau moteur produise EXACTEMENT le même
// résultat que l'ancien.
const CUMAC_BAR_TH_171: Record<string, Record<string, Record<string, number>>> = {
  H1: {
    moins70: { "111a140": 272_700, plus140: 327_600 },
    "70a90": { "111a140": 381_780, plus140: 458_640 },
    plus90: { "111a140": 545_400, plus140: 655_200 },
  },
  H2: {
    moins70: { "111a140": 227_250, plus140: 273_000 },
    "70a90": { "111a140": 318_150, plus140: 382_200 },
    plus90: { "111a140": 454_500, plus140: 546_000 },
  },
  H3: {
    moins70: { "111a140": 159_075, plus140: 191_100 },
    "70a90": { "111a140": 222_705, plus140: 267_540 },
    plus90: { "111a140": 318_150, plus140: 382_200 },
  },
};

export async function seedReglementaireDemo(prisma: PrismaClient) {
  const regle = await prisma.regleReglementaire.upsert({
    where: { code: "BAR-TH-171" },
    update: {},
    create: {
      code: "BAR-TH-171",
      famille: "CEE",
      secteur: "BAR",
      nom: "Pompe à chaleur de type air/eau",
      description:
        "Fiche CEE BAR-TH-171 - fiche pilote de la migration vers le moteur réglementaire versionné (P7). Reprend le comportement exact de l'ancien calculateur CeeCumacCalculator.tsx.",
      actif: true,
    },
  });

  const version = await prisma.regleReglementaireVersion.upsert({
    where: { regleId_numeroVersion: { regleId: regle.id, numeroVersion: "1" } },
    update: {},
    create: {
      regleId: regle.id,
      numeroVersion: "1",
      dateDebutEffet: new Date("2026-01-01"),
      dateFinEffet: null,
      publie: true,
      formulaCode: "BAR_TH_171_CUMAC_V1",
      sourceNom: "Barème Eco Environnement - Eco Negoce",
      sourceReference: "Tableau de valorisation CEE transmis (cf. commentaire historique de CeeCumacCalculator.tsx)",
      sourceUrl: null,
      sourceDatePublication: new Date("2026-01-01"),
      commentaire: "À VÉRIFIER : source officielle PNCEE/ADEME non jointe. Reprend les valeurs déjà utilisées par l'ancien calculateur.",
    },
  });

  let count = 0;
  for (const [zone, tranches] of Object.entries(CUMAC_BAR_TH_171)) {
    for (const [tranche, etasMap] of Object.entries(tranches)) {
      for (const [etas, valeur] of Object.entries(etasMap)) {
        const cle = `${zone}|${tranche}|${etas}`;
        await prisma.baremeReglementaire.upsert({
          where: { ruleVersionId_cle: { ruleVersionId: version.id, cle } },
          update: { valeur },
          create: { ruleVersionId: version.id, cle, valeur, metadata: { zone, tranche, etas } },
        });
        count += 1;
      }
    }
  }

  console.log(`Règle réglementaire BAR-TH-171 v1 prête (${count} valeurs de barème).`);
}
