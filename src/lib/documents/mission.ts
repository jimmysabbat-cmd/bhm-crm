import { prisma } from "@/lib/prisma";

// ============================================================
// P15 (60 min) - "Envoyer en mission" : réutilise EXACTEMENT le modèle
// TransmissionPackage/TransmissionPackageDocument de P10 (packages,
// snapshot figé, sécurité documentaire) au lieu d'un nouveau système.
// Seule différence avec createTransmissionPackage (P10 classique) :
// sélection MANUELLE des documents transmis (jamais un profil
// automatique par destination) et rattachement à UN posteTravauxId
// précis. Plusieurs missions (plusieurs sous-traitants) peuvent viser le
// même posteTravauxId - jamais de contrainte 1 poste = 1 sous-traitant.
//
// P16 - le même mécanisme sert aussi à assigner une équipe interne
// (Regie) : destinataire = sousTraitantId OU regieId, jamais les deux
// (destinationType SOUS_TRAITANT ou REGIE en conséquence). Une équipe
// interne n'a pas de portail (pas d'accepter/refuser côté partenaire) -
// le statut se pilote ensuite en interne (cf. updateMissionStatutAction).
// C'est cette unification qui permet au futur /planning de lire TOUTES
// les missions (ST et régie) depuis une seule source de vérité.
// ============================================================

export type ChampsClientPartages = {
  nom?: boolean;
  prenom?: boolean;
  telephone?: boolean;
  email?: boolean;
  adresse?: boolean;
};

export type MissionSnapshot = {
  client: Partial<Record<"nom" | "prenom" | "telephone" | "email" | "adresse", string>>;
  travaux: {
    type: string;
    surfaceM2: number | null;
    quantite: number | null;
    ficheReglementaireCode: string | null;
  };
};

export async function createMissionPackage(params: {
  organisationId: string;
  dossierId: string;
  posteTravauxId: string;
  sousTraitantId: string | null;
  regieId: string | null;
  champsPartages: ChampsClientPartages;
  documentIds: string[];
  dateDebutSouhaitee: Date | null;
  dateFinSouhaitee: Date | null;
  instructions: string | null;
  prixConvenuCts: number | null;
  createdById: string;
}): Promise<string> {
  if (!params.sousTraitantId === !params.regieId) {
    throw new Error("Choisissez exactement un destinataire : sous-traitant OU équipe interne.");
  }

  // Vérifications d'appartenance (jamais de confiance dans les IDs reçus du client)
  const poste = await prisma.dossierPosteTravaux.findFirst({
    where: { id: params.posteTravauxId, dossierId: params.dossierId },
    include: { dossier: { select: { organisationId: true, client: true } } },
  });
  if (!poste || poste.dossier.organisationId !== params.organisationId) throw new Error("Poste de travaux introuvable.");

  if (params.sousTraitantId) {
    const sousTraitant = await prisma.sousTraitant.findFirst({ where: { id: params.sousTraitantId, organisationId: params.organisationId } });
    if (!sousTraitant) throw new Error("Sous-traitant introuvable.");
  } else if (params.regieId) {
    const regie = await prisma.regie.findFirst({ where: { id: params.regieId, organisationId: params.organisationId } });
    if (!regie) throw new Error("Équipe interne introuvable.");
  }

  const documents =
    params.documentIds.length > 0
      ? await prisma.dossierDocument.findMany({ where: { id: { in: params.documentIds }, dossierId: params.dossierId } })
      : [];
  if (documents.length !== params.documentIds.length) throw new Error("Un ou plusieurs documents sélectionnés n'appartiennent pas à ce dossier.");

  const c = poste.dossier.client;
  const client: MissionSnapshot["client"] = {};
  if (params.champsPartages.nom) client.nom = c.nom;
  if (params.champsPartages.prenom) client.prenom = c.prenom;
  if (params.champsPartages.telephone && c.telephone) client.telephone = c.telephone;
  if (params.champsPartages.email && c.email) client.email = c.email;
  if (params.champsPartages.adresse && c.adresse) client.adresse = c.adresse;

  const snapshot: MissionSnapshot = {
    client,
    travaux: {
      type: poste.type,
      surfaceM2: poste.surfaceM2,
      quantite: poste.quantite,
      ficheReglementaireCode: poste.ficheReglementaireCode,
    },
  };

  const pkg = await prisma.transmissionPackage.create({
    data: {
      organisationId: params.organisationId,
      dossierId: params.dossierId,
      posteTravauxId: params.posteTravauxId,
      destinationType: params.sousTraitantId ? "SOUS_TRAITANT" : "REGIE",
      destinationSousTraitantId: params.sousTraitantId,
      destinationRegieId: params.regieId,
      status: "ENVOYEE",
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      comment: params.instructions,
      prixConvenuCts: params.prixConvenuCts,
      dateDebutSouhaitee: params.dateDebutSouhaitee,
      dateFinSouhaitee: params.dateFinSouhaitee,
      transmittedAt: new Date(),
      transmittedById: params.createdById,
      createdById: params.createdById,
      documents: {
        create: documents.map((d, i) => ({ dossierDocumentId: d.id, typeDocumentId: d.typeDocumentId, version: d.version, ordre: i })),
      },
    },
  });

  return pkg.id;
}
