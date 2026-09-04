import type { PrismaClient } from "../src/generated/prisma/client";

// ============================================================
// Référentiel documentaire P10 (section 1) - types globaux (organisationId
// null, comme RegleReglementaire) + quelques exigences d'exemple. Aucune
// exigence seedée n'est "blocking" sur une étape déjà utilisée par de vrais
// dossiers (section 12 : ne jamais bloquer par défaut - un blocage
// rétroactif sur un workflow déjà en cours surprendrait des utilisateurs
// réels). Les tests de blocage créent leurs propres exigences isolées.
// ============================================================

const TYPES_DOCUMENT = [
  { code: "DEVIS_SIGNE", nom: "Devis signé", categorie: "COMMERCIAL" },
  { code: "AUDIT_ENERGETIQUE", nom: "Audit énergétique", categorie: "TECHNIQUE" },
  { code: "AVIS_IMPOSITION", nom: "Avis d'imposition", categorie: "FISCAL" },
  { code: "PIECE_IDENTITE", nom: "Pièce d'identité", categorie: "IDENTITE" },
  { code: "TAXE_FONCIERE", nom: "Taxe foncière", categorie: "FISCAL" },
  { code: "RIB", nom: "RIB", categorie: "FINANCIER" },
  { code: "ATTESTATION_RGE", nom: "Attestation RGE", categorie: "TECHNIQUE" },
  { code: "FACTURE", nom: "Facture", categorie: "FINANCIER" },
  { code: "PV_RECEPTION", nom: "PV de réception", categorie: "TECHNIQUE" },
  { code: "PHOTOS_AVANT", nom: "Photos avant travaux", categorie: "TECHNIQUE" },
  { code: "PHOTOS_APRES", nom: "Photos après travaux", categorie: "TECHNIQUE" },
  { code: "CADRE_CONTRIBUTION_CEE", nom: "Cadre de contribution CEE", categorie: "CEE" },
  { code: "ATTESTATION_HONNEUR", nom: "Attestation sur l'honneur", categorie: "ADMINISTRATIF" },
  { code: "RAPPORT_CONTROLE", nom: "Rapport de contrôle", categorie: "TECHNIQUE" },
  { code: "MANDAT_ANAH", nom: "Mandat ANAH", categorie: "ANAH" },
  { code: "DOCUMENT_MAR", nom: "Document MAR", categorie: "ANAH" },
  { code: "AUTRE", nom: "Autre", categorie: null },
];

export async function seedDocumentReferentiel(prisma: PrismaClient) {
  // Pas d'upsert sur (organisationId, code) : organisationId est nullable
  // pour un type global et MySQL ne garantit pas l'unicité d'un couple
  // contenant NULL au niveau index (même raisonnement que Questionnaire en
  // P9) - on cherche donc explicitement avant de créer.
  const typeByCode: Record<string, string> = {};
  for (let i = 0; i < TYPES_DOCUMENT.length; i++) {
    const t = TYPES_DOCUMENT[i];
    const existing = await prisma.typeDocumentReferentiel.findFirst({ where: { organisationId: null, code: t.code } });
    const row = existing
      ? await prisma.typeDocumentReferentiel.update({ where: { id: existing.id }, data: { nom: t.nom, categorie: t.categorie } })
      : await prisma.typeDocumentReferentiel.create({ data: { organisationId: null, code: t.code, nom: t.nom, categorie: t.categorie, ordre: i } });
    typeByCode[t.code] = row.id;
  }

  console.log(`Référentiel documentaire prêt (${TYPES_DOCUMENT.length} types).`);

  // --- Quelques exigences d'exemple (non bloquantes sur les vraies étapes) ---
  const etapeDevisSigne = await prisma.etapeProgramme.findFirst({ where: { code: "DEVIS_SIGNE" } });
  const bareme = await prisma.regleReglementaireVersion.findFirst({ where: { regle: { code: "BAR-TH-171" } } });

  async function ensureRequirement(params: { typeCode: string; etapeProgrammeId?: string; regleVersionId?: string; typeTravaux?: string; obligatoire: boolean; responsable: string; destination: string }) {
    const existing = await prisma.documentRequirement.findFirst({
      where: { typeDocumentId: typeByCode[params.typeCode], etapeProgrammeId: params.etapeProgrammeId ?? null, regleVersionId: params.regleVersionId ?? null, typeTravaux: (params.typeTravaux as never) ?? null },
    });
    if (existing) return;
    await prisma.documentRequirement.create({
      data: {
        organisationId: null,
        typeDocumentId: typeByCode[params.typeCode],
        etapeProgrammeId: params.etapeProgrammeId ?? null,
        regleVersionId: params.regleVersionId ?? null,
        typeTravaux: (params.typeTravaux as never) ?? null,
        obligatoire: params.obligatoire,
        responsable: params.responsable as never,
        destination: params.destination as never,
        blocking: false,
      },
    });
  }

  if (etapeDevisSigne) {
    await ensureRequirement({ typeCode: "DEVIS_SIGNE", etapeProgrammeId: etapeDevisSigne.id, obligatoire: true, responsable: "CLIENT", destination: "ANAH" });
  }
  if (bareme) {
    await ensureRequirement({ typeCode: "CADRE_CONTRIBUTION_CEE", regleVersionId: bareme.id, obligatoire: true, responsable: "SOUS_TRAITANT", destination: "DELEGATAIRE_CEE" });
    await ensureRequirement({ typeCode: "ATTESTATION_HONNEUR", regleVersionId: bareme.id, obligatoire: true, responsable: "CLIENT", destination: "CEE" });
  }
  await ensureRequirement({ typeCode: "ATTESTATION_RGE", typeTravaux: "PAC_AIR_EAU", obligatoire: true, responsable: "SOUS_TRAITANT", destination: "CEE" });

  console.log("Exigences documentaires d'exemple prêtes.");
}
