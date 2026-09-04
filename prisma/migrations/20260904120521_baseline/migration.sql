-- CreateTable
CREATE TABLE `Organisation` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `raisonSociale` VARCHAR(191) NULL,
    `siret` VARCHAR(191) NULL,
    `tva` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `telephone` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Organisation_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NOT NULL DEFAULT 'COMMERCIAL',
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `isPlatformSuperAdmin` BOOLEAN NOT NULL DEFAULT false,
    `sousTraitantId` VARCHAR(191) NULL,
    `delegataireCeeId` VARCHAR(191) NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_organisationId_idx`(`organisationId`),
    INDEX `User_sousTraitantId_idx`(`sousTraitantId`),
    INDEX `User_delegataireCeeId_idx`(`delegataireCeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserInvitation_tokenHash_key`(`tokenHash`),
    INDEX `UserInvitation_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierType` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DossierType_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierStatus` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DossierStatus_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModePaiement` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ModePaiement_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mar` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mar_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Regie` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Regie_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DelegataireCee` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rachatTresModesteCts` INTEGER NULL,
    `rachatClassiqueCts` INTEGER NULL,
    `delaiPaiementJours` INTEGER NULL,

    INDEX `DelegataireCee_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatutAnah` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StatutAnah_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatutCee` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StatutCee_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatutTravaux` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StatutTravaux_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `prenom` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `telephone` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `codePostal` VARCHAR(191) NULL,
    `ville` VARCHAR(191) NULL,
    `precarite` ENUM('TRES_MODESTE', 'MODESTE', 'INTERMEDIAIRE', 'SUPERIEUR') NULL,
    `zoneClimatique` ENUM('H1', 'H2', 'H3') NULL,
    `surfaceHabitableM2` INTEGER NULL,
    `anneeConstruction` INTEGER NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Client_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Dossier` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NOT NULL,
    `statutId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `montantDevisTTC` INTEGER NOT NULL,
    `montantAideMPR` INTEGER NOT NULL DEFAULT 0,
    `montantAideCEE` INTEGER NOT NULL DEFAULT 0,
    `montantEncaisseClient` INTEGER NOT NULL DEFAULT 0,
    `montantEncaisseMPR` INTEGER NOT NULL DEFAULT 0,
    `montantEncaisseCEE` INTEGER NOT NULL DEFAULT 0,
    `modePaiementAideId` VARCHAR(191) NULL,
    `marId` VARCHAR(191) NULL,
    `delegataireCeeId` VARCHAR(191) NULL,
    `dateDepotDelegataireCee` DATETIME(3) NULL,
    `statutAnahId` VARCHAR(191) NULL,
    `dateDepotAnah` DATETIME(3) NULL,
    `dateOctroiAnah` DATETIME(3) NULL,
    `statutCeeId` VARCHAR(191) NULL,
    `statutTravauxId` VARCHAR(191) NULL,
    `programmeVersionId` VARCHAR(191) NULL,
    `dateSignatureDevis` DATETIME(3) NULL,
    `dateDebutTravaux` DATETIME(3) NULL,
    `dateFinTravaux` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Dossier_reference_key`(`reference`),
    INDEX `Dossier_statutId_idx`(`statutId`),
    INDEX `Dossier_typeId_idx`(`typeId`),
    INDEX `Dossier_clientId_idx`(`clientId`),
    INDEX `Dossier_organisationId_idx`(`organisationId`),
    INDEX `Dossier_statutCeeId_idx`(`statutCeeId`),
    INDEX `Dossier_statutTravauxId_idx`(`statutTravauxId`),
    INDEX `Dossier_programmeVersionId_idx`(`programmeVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierPosteTravaux` (
    `id` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NOT NULL,
    `surfaceM2` DOUBLE NULL,
    `quantite` INTEGER NULL,
    `montantDevisHTCts` INTEGER NULL,
    `montantDevisTTCCts` INTEGER NULL,
    `montantCumac` INTEGER NULL,
    `montantPrimeCalculeCts` INTEGER NULL,
    `sousTraitantId` VARCHAR(191) NULL,
    `montantPoseSousTraitanceCts` INTEGER NULL,
    `regieId` VARCHAR(191) NULL,
    `montantRegieCts` INTEGER NULL,
    `montantMaterielHTCts` INTEGER NULL,
    `montantMaterielTTCCts` INTEGER NULL,
    `ficheReglementaireCode` VARCHAR(191) NULL,
    `calculReglementaireActifId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DossierPosteTravaux_calculReglementaireActifId_key`(`calculReglementaireActifId`),
    INDEX `DossierPosteTravaux_dossierId_idx`(`dossierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SousTraitant` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `typeTravaux` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NULL,
    `tarifM2Cts` INTEGER NULL,
    `tarifFixeCts` INTEGER NULL,
    `fourniPose` BOOLEAN NOT NULL DEFAULT false,
    `telephone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `delaiPaiementJours` INTEGER NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SousTraitant_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierDocument` (
    `id` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('DEVIS', 'AUDIT', 'PHOTO_VISITE', 'PHOTO_CHANTIER', 'AUTRE') NOT NULL,
    `nomFichier` VARCHAR(191) NOT NULL,
    `cheminFichier` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `tailleOctets` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `organisationId` VARCHAR(191) NULL,
    `typeDocumentId` VARCHAR(191) NULL,
    `requirementId` VARCHAR(191) NULL,
    `portee` ENUM('DOSSIER', 'CLIENT', 'MENAGE', 'LOGEMENT', 'POSTE_TRAVAUX', 'ENTREPRISE', 'PARTENAIRE') NOT NULL DEFAULT 'DOSSIER',
    `clientId` VARCHAR(191) NULL,
    `posteTravauxId` VARCHAR(191) NULL,
    `statut` ENUM('FOURNI', 'A_VERIFIER', 'VALIDE', 'REFUSE', 'EXPIRE', 'REMPLACE') NOT NULL DEFAULT 'FOURNI',
    `dateExpiration` DATETIME(3) NULL,
    `validatedById` VARCHAR(191) NULL,
    `validatedAt` DATETIME(3) NULL,
    `validationComment` VARCHAR(191) NULL,
    `rejectionReason` VARCHAR(191) NULL,
    `replacesId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `provenance` ENUM('CLIENT', 'COMMERCIAL', 'VISITE', 'AUDIT', 'API', 'DOCUMENT', 'IMPORT', 'AUTRE') NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `DossierDocument_dossierId_idx`(`dossierId`),
    INDEX `DossierDocument_organisationId_idx`(`organisationId`),
    INDEX `DossierDocument_typeDocumentId_idx`(`typeDocumentId`),
    INDEX `DossierDocument_requirementId_idx`(`requirementId`),
    INDEX `DossierDocument_statut_idx`(`statut`),
    INDEX `DossierDocument_clientId_idx`(`clientId`),
    INDEX `DossierDocument_posteTravauxId_idx`(`posteTravauxId`),
    INDEX `DossierDocument_replacesId_idx`(`replacesId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TypeDocumentReferentiel` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `categorie` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TypeDocumentReferentiel_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentRequirement` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `typeDocumentId` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NULL,
    `regleVersionId` VARCHAR(191) NULL,
    `typeTravaux` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `condition` VARCHAR(191) NULL,
    `momentRequis` VARCHAR(191) NULL,
    `responsable` ENUM('CLIENT', 'COMMERCIAL', 'ADMINISTRATIF', 'TECHNIQUE', 'MAR', 'SOUS_TRAITANT', 'FOURNISSEUR', 'AUTRE') NULL,
    `destination` ENUM('ANAH', 'MAR', 'CEE', 'DELEGATAIRE_CEE', 'CONTROLEUR', 'SOUS_TRAITANT', 'FOURNISSEUR', 'CLIENT', 'COMPTABILITE', 'AUTRE') NULL,
    `validiteJours` INTEGER NULL,
    `multipleAutorise` BOOLEAN NOT NULL DEFAULT false,
    `minCount` INTEGER NOT NULL DEFAULT 1,
    `maxCount` INTEGER NULL,
    `portee` ENUM('DOSSIER', 'CLIENT', 'MENAGE', 'LOGEMENT', 'POSTE_TRAVAUX', 'ENTREPRISE', 'PARTENAIRE') NOT NULL DEFAULT 'DOSSIER',
    `blocking` BOOLEAN NOT NULL DEFAULT false,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `commentaire` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentRequirement_organisationId_idx`(`organisationId`),
    INDEX `DocumentRequirement_etapeProgrammeId_idx`(`etapeProgrammeId`),
    INDEX `DocumentRequirement_regleVersionId_idx`(`regleVersionId`),
    INDEX `DocumentRequirement_typeDocumentId_idx`(`typeDocumentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransmissionPackage` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `destinationType` ENUM('ANAH', 'MAR', 'CEE', 'DELEGATAIRE_CEE', 'CONTROLEUR', 'SOUS_TRAITANT', 'FOURNISSEUR', 'CLIENT', 'COMPTABILITE', 'AUTRE') NOT NULL,
    `destinationName` VARCHAR(191) NULL,
    `destinationSousTraitantId` VARCHAR(191) NULL,
    `destinationDelegataireCeeId` VARCHAR(191) NULL,
    `status` ENUM('BROUILLON', 'PRET', 'TRANSMIS', 'ANNULE') NOT NULL DEFAULT 'BROUILLON',
    `snapshot` JSON NOT NULL,
    `comment` VARCHAR(191) NULL,
    `transmittedAt` DATETIME(3) NULL,
    `transmittedById` VARCHAR(191) NULL,
    `externalReference` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TransmissionPackage_organisationId_idx`(`organisationId`),
    INDEX `TransmissionPackage_dossierId_idx`(`dossierId`),
    INDEX `TransmissionPackage_destinationSousTraitantId_idx`(`destinationSousTraitantId`),
    INDEX `TransmissionPackage_destinationDelegataireCeeId_idx`(`destinationDelegataireCeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransmissionPackageDocument` (
    `id` VARCHAR(191) NOT NULL,
    `packageId` VARCHAR(191) NOT NULL,
    `dossierDocumentId` VARCHAR(191) NOT NULL,
    `typeDocumentId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,

    INDEX `TransmissionPackageDocument_packageId_idx`(`packageId`),
    INDEX `TransmissionPackageDocument_dossierDocumentId_idx`(`dossierDocumentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Fournisseur` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `delaiPaiementJours` INTEGER NULL,
    `telephone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Fournisseur_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Commande` (
    `id` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `fournisseurId` VARCHAR(191) NULL,
    `sousTraitantId` VARCHAR(191) NULL,
    `numeroBL` VARCHAR(191) NULL,
    `montantCts` INTEGER NOT NULL,
    `statut` ENUM('COMMANDEE', 'LIVREE', 'RETIREE', 'ANNULEE') NOT NULL DEFAULT 'COMMANDEE',
    `dateCommande` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dateLivraisonPrevue` DATETIME(3) NULL,
    `dateLivraisonReelle` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Commande_dossierId_idx`(`dossierId`),
    INDEX `Commande_fournisseurId_idx`(`fournisseurId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tache` (
    `id` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('RELANCE_CLIENT', 'RELANCE_CEE', 'RELANCE_ANAH', 'RELANCE_FOURNISSEUR', 'RELANCE_SOUS_TRAITANT', 'AUTRE') NOT NULL,
    `titre` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `dateEcheance` DATETIME(3) NOT NULL,
    `statut` ENUM('A_FAIRE', 'FAIT', 'ANNULE') NOT NULL DEFAULT 'A_FAIRE',
    `assigneAId` VARCHAR(191) NULL,
    `dossierEtapeId` VARCHAR(191) NULL,
    `modeleTacheEtapeId` VARCHAR(191) NULL,
    `derniereRelanceAt` DATETIME(3) NULL,
    `nombreRelances` INTEGER NOT NULL DEFAULT 0,
    `prochaineRelanceAt` DATETIME(3) NULL,
    `regleRelanceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Tache_dossierId_idx`(`dossierId`),
    INDEX `Tache_statut_dateEcheance_idx`(`statut`, `dateEcheance`),
    UNIQUE INDEX `Tache_dossierEtapeId_modeleTacheEtapeId_key`(`dossierEtapeId`, `modeleTacheEtapeId`),
    UNIQUE INDEX `Tache_dossierEtapeId_regleRelanceId_key`(`dossierEtapeId`, `regleRelanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegleRelance` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'AUTRE') NOT NULL,
    `typeAction` VARCHAR(191) NULL,
    `apresJours` INTEGER NOT NULL,
    `recurrenceJours` INTEGER NULL,
    `maxRelances` INTEGER NULL,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RegleRelance_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MouvementFinancier` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('ENTREE', 'SORTIE') NOT NULL,
    `categorie` ENUM('ENCAISSEMENT_CLIENT', 'ENCAISSEMENT_ANAH', 'ENCAISSEMENT_MPR', 'ENCAISSEMENT_CEE', 'PAIEMENT_SOUS_TRAITANT', 'PAIEMENT_FOURNISSEUR', 'COMMISSION_COMMERCIALE', 'COMMISSION_REGIE', 'COMMISSION_APPORTEUR', 'AUTRE_ENTREE', 'AUTRE_SORTIE', 'CLIENT_ACOMPTE', 'CLIENT_SOLDE', 'REMBOURSEMENT_AVANCE_CLIENT', 'FINANCEMENT_PARTENAIRE', 'POSE_INTERNE', 'PAIEMENT_MAR', 'PAIEMENT_AUDIT', 'PAIEMENT_CONTROLE', 'TRANSPORT', 'LOCATION_MATERIEL', 'ECHAFAUDAGE', 'FRAIS_FINANCEMENT') NOT NULL,
    `payeur` VARCHAR(191) NULL,
    `beneficiaire` VARCHAR(191) NULL,
    `payeurType` ENUM('CLIENT', 'ENTREPRISE', 'ANAH', 'CEE', 'FINANCEUR', 'FOURNISSEUR', 'SOUS_TRAITANT', 'REGIE', 'COMMERCIAL', 'APPORTEUR', 'MAR', 'AUTRE') NULL,
    `beneficiaireType` ENUM('CLIENT', 'ENTREPRISE', 'ANAH', 'CEE', 'FINANCEUR', 'FOURNISSEUR', 'SOUS_TRAITANT', 'REGIE', 'COMMERCIAL', 'APPORTEUR', 'MAR', 'AUTRE') NULL,
    `montantPrevuCts` INTEGER NULL,
    `montantReelCts` INTEGER NULL,
    `datePrevue` DATETIME(3) NULL,
    `dateReelle` DATETIME(3) NULL,
    `exigibleQuand` ENUM('A_LA_SIGNATURE', 'A_L_ACCEPTATION', 'AU_DEMARRAGE_TRAVAUX', 'A_LA_FIN_TRAVAUX', 'A_L_ENCAISSEMENT_CLIENT', 'A_L_ENCAISSEMENT_ANAH', 'A_L_ENCAISSEMENT_CEE', 'MANUEL') NULL,
    `statut` ENUM('PREVU', 'A_RECEVOIR', 'A_PAYER', 'PARTIEL', 'RECU', 'PAYE', 'ANNULE', 'EN_RETARD', 'LITIGE', 'BLOQUE') NOT NULL DEFAULT 'PREVU',
    `origine` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MouvementFinancier_dossierId_idx`(`dossierId`),
    INDEX `MouvementFinancier_organisationId_idx`(`organisationId`),
    INDEX `MouvementFinancier_statut_idx`(`statut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_organisationId_idx`(`organisationId`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Programme` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Programme_organisationId_idx`(`organisationId`),
    UNIQUE INDEX `Programme_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProgrammeVersion` (
    `id` VARCHAR(191) NOT NULL,
    `programmeId` VARCHAR(191) NOT NULL,
    `numeroVersion` VARCHAR(191) NOT NULL,
    `nomVersion` VARCHAR(191) NULL,
    `dateDebutEffet` DATETIME(3) NULL,
    `dateFinEffet` DATETIME(3) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `publie` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProgrammeVersion_programmeId_idx`(`programmeId`),
    UNIQUE INDEX `ProgrammeVersion_programmeId_numeroVersion_key`(`programmeId`, `numeroVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EtapeProgramme` (
    `id` VARCHAR(191) NOT NULL,
    `programmeVersionId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'AUTRE') NOT NULL DEFAULT 'AUTRE',
    `delaiNormalJours` INTEGER NULL,
    `delaiAlerteJours` INTEGER NULL,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EtapeProgramme_programmeVersionId_idx`(`programmeVersionId`),
    UNIQUE INDEX `EtapeProgramme_programmeVersionId_code_key`(`programmeVersionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EtapeDependance` (
    `id` VARCHAR(191) NOT NULL,
    `etapeId` VARCHAR(191) NOT NULL,
    `dependsOnEtapeId` VARCHAR(191) NOT NULL,
    `type` ENUM('ALL_COMPLETED') NOT NULL DEFAULT 'ALL_COMPLETED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EtapeDependance_etapeId_idx`(`etapeId`),
    INDEX `EtapeDependance_dependsOnEtapeId_idx`(`dependsOnEtapeId`),
    UNIQUE INDEX `EtapeDependance_etapeId_dependsOnEtapeId_key`(`etapeId`, `dependsOnEtapeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EtapeDocumentRequis` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `typeDocument` ENUM('DEVIS', 'AUDIT', 'PHOTO_VISITE', 'PHOTO_CHANTIER', 'AUTRE') NOT NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EtapeDocumentRequis_etapeProgrammeId_idx`(`etapeProgrammeId`),
    UNIQUE INDEX `EtapeDocumentRequis_etapeProgrammeId_typeDocument_key`(`etapeProgrammeId`, `typeDocument`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModeleTacheEtape` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `titre` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `type` ENUM('RELANCE_CLIENT', 'RELANCE_CEE', 'RELANCE_ANAH', 'RELANCE_FOURNISSEUR', 'RELANCE_SOUS_TRAITANT', 'AUTRE') NOT NULL DEFAULT 'AUTRE',
    `delaiJours` INTEGER NOT NULL DEFAULT 0,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModeleTacheEtape_etapeProgrammeId_idx`(`etapeProgrammeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierEtape` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `statut` ENUM('NON_DISPONIBLE', 'A_FAIRE', 'EN_COURS', 'EN_ATTENTE', 'BLOQUE', 'TERMINE', 'IGNORE', 'ANNULE') NOT NULL DEFAULT 'NON_DISPONIBLE',
    `dateDisponible` DATETIME(3) NULL,
    `dateDebut` DATETIME(3) NULL,
    `dateEcheance` DATETIME(3) NULL,
    `dateTerminee` DATETIME(3) NULL,
    `assignedUserId` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `bloque` BOOLEAN NOT NULL DEFAULT false,
    `raisonBlocage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DossierEtape_organisationId_idx`(`organisationId`),
    INDEX `DossierEtape_dossierId_idx`(`dossierId`),
    INDEX `DossierEtape_etapeProgrammeId_idx`(`etapeProgrammeId`),
    INDEX `DossierEtape_statut_idx`(`statut`),
    UNIQUE INDEX `DossierEtape_dossierId_etapeProgrammeId_key`(`dossierId`, `etapeProgrammeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegleReglementaire` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `famille` VARCHAR(191) NOT NULL,
    `secteur` ENUM('BAR', 'BAT', 'IND', 'AGRI', 'TRA', 'RES', 'AUTRE') NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RegleReglementaire_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegleReglementaireVersion` (
    `id` VARCHAR(191) NOT NULL,
    `regleId` VARCHAR(191) NOT NULL,
    `numeroVersion` VARCHAR(191) NOT NULL,
    `dateDebutEffet` DATETIME(3) NOT NULL,
    `dateFinEffet` DATETIME(3) NULL,
    `publie` BOOLEAN NOT NULL DEFAULT false,
    `formulaCode` VARCHAR(191) NOT NULL,
    `sourceNom` VARCHAR(191) NOT NULL,
    `sourceReference` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourceDatePublication` DATETIME(3) NULL,
    `commentaire` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RegleReglementaireVersion_regleId_idx`(`regleId`),
    UNIQUE INDEX `RegleReglementaireVersion_regleId_numeroVersion_key`(`regleId`, `numeroVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BaremeReglementaire` (
    `id` VARCHAR(191) NOT NULL,
    `ruleVersionId` VARCHAR(191) NOT NULL,
    `cle` VARCHAR(191) NOT NULL,
    `valeur` INTEGER NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BaremeReglementaire_ruleVersionId_idx`(`ruleVersionId`),
    UNIQUE INDEX `BaremeReglementaire_ruleVersionId_cle_key`(`ruleVersionId`, `cle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalculReglementaire` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `posteTravauxId` VARCHAR(191) NULL,
    `ruleVersionId` VARCHAR(191) NOT NULL,
    `type` ENUM('SIMULATION', 'OFFICIEL') NOT NULL,
    `dateEngagement` DATETIME(3) NOT NULL,
    `inputs` JSON NOT NULL,
    `resultat` JSON NOT NULL,
    `kwhCumac` INTEGER NULL,
    `statutEligibilite` ENUM('ELIGIBLE', 'ELIGIBLE_PROBABLE', 'A_CONFIRMER', 'NON_ELIGIBLE', 'BLOQUE', 'DONNEES_INSUFFISANTES') NOT NULL,
    `overrideStatutEligibilite` ENUM('ELIGIBLE', 'ELIGIBLE_PROBABLE', 'A_CONFIRMER', 'NON_ELIGIBLE', 'BLOQUE', 'DONNEES_INSUFFISANTES') NULL,
    `overrideKwhCumac` INTEGER NULL,
    `overrideReason` VARCHAR(191) NULL,
    `overrideById` VARCHAR(191) NULL,
    `overrideAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CalculReglementaire_organisationId_idx`(`organisationId`),
    INDEX `CalculReglementaire_dossierId_idx`(`dossierId`),
    INDEX `CalculReglementaire_posteTravauxId_idx`(`posteTravauxId`),
    INDEX `CalculReglementaire_ruleVersionId_idx`(`ruleVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TarifDelegataireCee` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `delegataireId` VARCHAR(191) NOT NULL,
    `ficheCode` VARCHAR(191) NULL,
    `categorie` VARCHAR(191) NOT NULL,
    `tauxCtsParMwhc` INTEGER NOT NULL,
    `dateDebut` DATETIME(3) NOT NULL,
    `dateFin` DATETIME(3) NULL,
    `delaiPaiementJours` INTEGER NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `commentaire` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TarifDelegataireCee_organisationId_idx`(`organisationId`),
    INDEX `TarifDelegataireCee_delegataireId_idx`(`delegataireId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EtudeDossier` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `mode` ENUM('SIMULATION', 'OFFICIEL') NOT NULL,
    `inputsSnapshot` JSON NOT NULL,
    `resultsSnapshot` JSON NOT NULL,
    `inputHash` VARCHAR(191) NOT NULL,
    `recommendedScenarioId` VARCHAR(191) NULL,
    `selectedScenarioId` VARCHAR(191) NULL,
    `selectedAt` DATETIME(3) NULL,
    `selectedById` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EtudeDossier_organisationId_idx`(`organisationId`),
    INDEX `EtudeDossier_dossierId_idx`(`dossierId`),
    UNIQUE INDEX `EtudeDossier_dossierId_version_key`(`dossierId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadSource` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeadSource_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadPipelineStatus` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeadPipelineStatus_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultatAppel` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `proposeStatutId` VARCHAR(191) NULL,
    `proposeDelaiRappelJours` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ResultatAppel_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `sourceDetail` VARCHAR(191) NULL,
    `prenom` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `telephone` VARCHAR(191) NULL,
    `telephoneNormalise` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `codePostal` VARCHAR(191) NULL,
    `ville` VARCHAR(191) NULL,
    `commercialId` VARCHAR(191) NULL,
    `teleprospecteurId` VARCHAR(191) NULL,
    `statutId` VARCHAR(191) NOT NULL,
    `temperature` ENUM('FROID', 'TIEDE', 'CHAUD') NOT NULL DEFAULT 'TIEDE',
    `dernierResultatId` VARCHAR(191) NULL,
    `prochainContactAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `claimedById` VARCHAR(191) NULL,
    `claimedAt` DATETIME(3) NULL,
    `claimExpiresAt` DATETIME(3) NULL,
    `clientId` VARCHAR(191) NULL,
    `dossierId` VARCHAR(191) NULL,
    `convertedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Lead_dossierId_key`(`dossierId`),
    INDEX `Lead_organisationId_idx`(`organisationId`),
    INDEX `Lead_commercialId_idx`(`commercialId`),
    INDEX `Lead_teleprospecteurId_idx`(`teleprospecteurId`),
    INDEX `Lead_statutId_idx`(`statutId`),
    INDEX `Lead_telephoneNormalise_idx`(`telephoneNormalise`),
    INDEX `Lead_email_idx`(`email`),
    INDEX `Lead_prochainContactAt_idx`(`prochainContactAt`),
    INDEX `Lead_claimedById_idx`(`claimedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `oldStatusId` VARCHAR(191) NULL,
    `newStatusId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeadStatusHistory_leadId_idx`(`leadId`),
    INDEX `LeadStatusHistory_newStatusId_idx`(`newStatusId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Logement` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `dossierId` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `complement` VARCHAR(191) NULL,
    `codePostal` VARCHAR(191) NULL,
    `ville` VARCHAR(191) NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `typeBatiment` ENUM('MAISON', 'APPARTEMENT') NULL,
    `typeHabitat` ENUM('INDIVIDUEL', 'COLLECTIF') NULL,
    `anneeConstruction` INTEGER NULL,
    `surfaceHabitableM2` DOUBLE NULL,
    `surfaceChauffeeM2` DOUBLE NULL,
    `nombreNiveaux` INTEGER NULL,
    `nombreLogements` INTEGER NULL,
    `chauffagePrincipal` ENUM('ELECTRICITE', 'GAZ', 'FIOUL', 'BOIS', 'PAC', 'RESEAU_CHALEUR', 'AUTRE') NULL,
    `equipementChauffage` VARCHAR(191) NULL,
    `anneeEquipementChauffage` INTEGER NULL,
    `ecs` BOOLEAN NULL,
    `energieEcs` ENUM('ELECTRICITE', 'GAZ', 'FIOUL', 'BOIS', 'PAC', 'RESEAU_CHALEUR', 'AUTRE') NULL,
    `climatisation` BOOLEAN NULL,
    `dpe` VARCHAR(191) NULL,
    `consommationAnnuelleKwh` INTEGER NULL,
    `isolationMurs` VARCHAR(191) NULL,
    `isolationCombles` VARCHAR(191) NULL,
    `isolationRampants` VARCHAR(191) NULL,
    `isolationPlancherBas` VARCHAR(191) NULL,
    `isolationFenetres` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Logement_leadId_key`(`leadId`),
    UNIQUE INDEX `Logement_clientId_key`(`clientId`),
    UNIQUE INDEX `Logement_dossierId_key`(`dossierId`),
    INDEX `Logement_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChampProvenance` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `logementId` VARCHAR(191) NOT NULL,
    `champ` VARCHAR(191) NOT NULL,
    `source` ENUM('CLIENT', 'COMMERCIAL', 'VISITE', 'AUDIT', 'API', 'DOCUMENT', 'IMPORT', 'AUTRE') NOT NULL,
    `confiance` ENUM('DECLARE', 'ESTIME', 'VERIFIE') NOT NULL DEFAULT 'DECLARE',
    `valeurProposee` VARCHAR(191) NULL,
    `sourceProposee` ENUM('CLIENT', 'COMMERCIAL', 'VISITE', 'AUDIT', 'API', 'DOCUMENT', 'IMPORT', 'AUTRE') NULL,
    `referenceExterne` VARCHAR(191) NULL,
    `recupereeAt` DATETIME(3) NULL,
    `accepteeById` VARCHAR(191) NULL,
    `accepteeAt` DATETIME(3) NULL,
    `refuseeAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChampProvenance_organisationId_idx`(`organisationId`),
    UNIQUE INDEX `ChampProvenance_logementId_champ_key`(`logementId`, `champ`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Questionnaire` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Questionnaire_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuestionnaireVersion` (
    `id` VARCHAR(191) NOT NULL,
    `questionnaireId` VARCHAR(191) NOT NULL,
    `numeroVersion` INTEGER NOT NULL,
    `publiee` BOOLEAN NOT NULL DEFAULT false,
    `publieeAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `QuestionnaireVersion_questionnaireId_numeroVersion_key`(`questionnaireId`, `numeroVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Question` (
    `id` VARCHAR(191) NOT NULL,
    `questionnaireVersionId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `type` ENUM('TEXT', 'NUMBER', 'YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT', 'DATE') NOT NULL,
    `unite` VARCHAR(191) NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `obligatoire` BOOLEAN NOT NULL DEFAULT false,
    `section` VARCHAR(191) NOT NULL,
    `champMappe` VARCHAR(191) NULL,

    INDEX `Question_questionnaireVersionId_idx`(`questionnaireVersionId`),
    UNIQUE INDEX `Question_questionnaireVersionId_code_key`(`questionnaireVersionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OptionQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `OptionQuestion_questionId_code_key`(`questionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConditionQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `questionDeclenchanteId` VARCHAR(191) NOT NULL,
    `valeurAttendue` VARCHAR(191) NOT NULL,

    INDEX `ConditionQuestion_questionId_idx`(`questionId`),
    INDEX `ConditionQuestion_questionDeclenchanteId_idx`(`questionDeclenchanteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReponseQuestionnaire` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `questionnaireVersionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReponseQuestionnaire_organisationId_idx`(`organisationId`),
    UNIQUE INDEX `ReponseQuestionnaire_leadId_questionnaireVersionId_key`(`leadId`, `questionnaireVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReponseQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `reponseQuestionnaireId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `valeurTexte` VARCHAR(191) NULL,
    `valeurNombre` DOUBLE NULL,
    `valeurBool` BOOLEAN NULL,
    `valeurDate` DATETIME(3) NULL,
    `valeurOptions` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReponseQuestion_reponseQuestionnaireId_questionId_key`(`reponseQuestionnaireId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InteractionCommerciale` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `type` ENUM('APPEL', 'EMAIL', 'SMS', 'VISITE', 'AUTRE') NOT NULL,
    `resultatId` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `dureeMinutes` INTEGER NULL,
    `prochaineActionAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InteractionCommerciale_organisationId_idx`(`organisationId`),
    INDEX `InteractionCommerciale_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rdv` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `dossierId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `type` ENUM('TELEPHONIQUE', 'VISITE', 'AUTRE') NOT NULL,
    `commercialId` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `statut` ENUM('PLANIFIE', 'CONFIRME', 'REALISE', 'ANNULE') NOT NULL DEFAULT 'PLANIFIE',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Rdv_organisationId_idx`(`organisationId`),
    INDEX `Rdv_leadId_idx`(`leadId`),
    INDEX `Rdv_dossierId_idx`(`dossierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRule` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `triggerType` ENUM('DOSSIER_STATUS_CHANGED', 'WORKFLOW_STEP_READY', 'WORKFLOW_STEP_LATE', 'DOCUMENT_MISSING', 'DOCUMENT_REJECTED', 'DOCUMENT_EXPIRED', 'TRANSMISSION_READY', 'LEAD_STATUS_CHANGED', 'LEAD_CALLBACK_DUE', 'APPOINTMENT_UPCOMING', 'FINANCIAL_PAYMENT_DUE', 'FINANCIAL_PAYMENT_LATE', 'CEE_READY', 'ANAH_STATUS_CHANGED', 'STUDY_STALE', 'MANUAL_TRIGGER') NOT NULL,
    `triggerConfig` JSON NULL,
    `actionType` ENUM('CREATE_TASK', 'CREATE_NOTIFICATION', 'PREPARE_EMAIL', 'SEND_EMAIL', 'PREPARE_DOCUMENT_REQUEST', 'PREPARE_TRANSMISSION', 'MARK_FLAG', 'ASSIGN_USER', 'UPDATE_STATUS_IF_SAFE', 'WEBHOOK_OUTGOING') NOT NULL,
    `actionConfig` JSON NULL,
    `delayMinutes` INTEGER NULL,
    `delayJours` INTEGER NULL,
    `conditions` JSON NULL,
    `mode` ENUM('MANUAL', 'AUTO', 'PREPARE_ONLY') NOT NULL DEFAULT 'PREPARE_ONLY',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AutomationRule_organisationId_idx`(`organisationId`),
    INDEX `AutomationRule_triggerType_idx`(`triggerType`),
    UNIQUE INDEX `AutomationRule_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationExecution` (
    `id` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `triggerKey` VARCHAR(191) NOT NULL,
    `status` ENUM('SUCCESS', 'SKIPPED', 'ERROR', 'DRY_RUN') NOT NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `executedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AutomationExecution_organisationId_idx`(`organisationId`),
    INDEX `AutomationExecution_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AutomationExecution_executedAt_idx`(`executedAt`),
    UNIQUE INDEX `AutomationExecution_ruleId_entityType_entityId_triggerKey_key`(`ruleId`, `entityType`, `entityId`, `triggerKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `sujetTemplate` VARCHAR(191) NOT NULL,
    `bodyTemplate` TEXT NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailTemplate_organisationId_idx`(`organisationId`),
    UNIQUE INDEX `EmailTemplate_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailDraft` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `dossierId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `destinataire` VARCHAR(191) NOT NULL,
    `sujet` VARCHAR(191) NOT NULL,
    `corps` TEXT NOT NULL,
    `statut` ENUM('BROUILLON', 'ENVOYE', 'ANNULE') NOT NULL DEFAULT 'BROUILLON',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailDraft_organisationId_idx`(`organisationId`),
    INDEX `EmailDraft_dossierId_idx`(`dossierId`),
    INDEX `EmailDraft_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailSendLog` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `draftId` VARCHAR(191) NULL,
    `dossierId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `destinataire` VARCHAR(191) NOT NULL,
    `sujet` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `statut` ENUM('ENVOYE', 'ERREUR') NOT NULL,
    `erreur` VARCHAR(191) NULL,
    `sentById` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailSendLog_draftId_key`(`draftId`),
    INDEX `EmailSendLog_organisationId_idx`(`organisationId`),
    INDEX `EmailSendLog_dossierId_idx`(`dossierId`),
    INDEX `EmailSendLog_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `Notification_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEndpoint` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `eventTypes` JSON NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookEndpoint_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `endpointId` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `responseStatus` INTEGER NULL,
    `error` TEXT NULL,
    `statut` ENUM('EN_ATTENTE', 'ENVOYE', 'ECHEC') NOT NULL DEFAULT 'EN_ATTENTE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookDelivery_endpointId_idx`(`endpointId`),
    INDEX `WebhookDelivery_organisationId_idx`(`organisationId`),
    INDEX `WebhookDelivery_statut_idx`(`statut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_sousTraitantId_fkey` FOREIGN KEY (`sousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_delegataireCeeId_fkey` FOREIGN KEY (`delegataireCeeId`) REFERENCES `DelegataireCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserInvitation` ADD CONSTRAINT `UserInvitation_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserInvitation` ADD CONSTRAINT `UserInvitation_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mar` ADD CONSTRAINT `Mar_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Regie` ADD CONSTRAINT `Regie_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DelegataireCee` ADD CONSTRAINT `DelegataireCee_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `DossierType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutId_fkey` FOREIGN KEY (`statutId`) REFERENCES `DossierStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_modePaiementAideId_fkey` FOREIGN KEY (`modePaiementAideId`) REFERENCES `ModePaiement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_marId_fkey` FOREIGN KEY (`marId`) REFERENCES `Mar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_delegataireCeeId_fkey` FOREIGN KEY (`delegataireCeeId`) REFERENCES `DelegataireCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutAnahId_fkey` FOREIGN KEY (`statutAnahId`) REFERENCES `StatutAnah`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutCeeId_fkey` FOREIGN KEY (`statutCeeId`) REFERENCES `StatutCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutTravauxId_fkey` FOREIGN KEY (`statutTravauxId`) REFERENCES `StatutTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_programmeVersionId_fkey` FOREIGN KEY (`programmeVersionId`) REFERENCES `ProgrammeVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_sousTraitantId_fkey` FOREIGN KEY (`sousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_regieId_fkey` FOREIGN KEY (`regieId`) REFERENCES `Regie`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_calculReglementaireActifId_fkey` FOREIGN KEY (`calculReglementaireActifId`) REFERENCES `CalculReglementaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SousTraitant` ADD CONSTRAINT `SousTraitant_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_typeDocumentId_fkey` FOREIGN KEY (`typeDocumentId`) REFERENCES `TypeDocumentReferentiel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `DocumentRequirement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_posteTravauxId_fkey` FOREIGN KEY (`posteTravauxId`) REFERENCES `DossierPosteTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_replacesId_fkey` FOREIGN KEY (`replacesId`) REFERENCES `DossierDocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TypeDocumentReferentiel` ADD CONSTRAINT `TypeDocumentReferentiel_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRequirement` ADD CONSTRAINT `DocumentRequirement_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRequirement` ADD CONSTRAINT `DocumentRequirement_typeDocumentId_fkey` FOREIGN KEY (`typeDocumentId`) REFERENCES `TypeDocumentReferentiel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRequirement` ADD CONSTRAINT `DocumentRequirement_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRequirement` ADD CONSTRAINT `DocumentRequirement_regleVersionId_fkey` FOREIGN KEY (`regleVersionId`) REFERENCES `RegleReglementaireVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_destinationSousTraitantId_fkey` FOREIGN KEY (`destinationSousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_destinationDelegataireCeeId_fkey` FOREIGN KEY (`destinationDelegataireCeeId`) REFERENCES `DelegataireCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_transmittedById_fkey` FOREIGN KEY (`transmittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackageDocument` ADD CONSTRAINT `TransmissionPackageDocument_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `TransmissionPackage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackageDocument` ADD CONSTRAINT `TransmissionPackageDocument_dossierDocumentId_fkey` FOREIGN KEY (`dossierDocumentId`) REFERENCES `DossierDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackageDocument` ADD CONSTRAINT `TransmissionPackageDocument_typeDocumentId_fkey` FOREIGN KEY (`typeDocumentId`) REFERENCES `TypeDocumentReferentiel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fournisseur` ADD CONSTRAINT `Fournisseur_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Commande` ADD CONSTRAINT `Commande_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Commande` ADD CONSTRAINT `Commande_fournisseurId_fkey` FOREIGN KEY (`fournisseurId`) REFERENCES `Fournisseur`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Commande` ADD CONSTRAINT `Commande_sousTraitantId_fkey` FOREIGN KEY (`sousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_assigneAId_fkey` FOREIGN KEY (`assigneAId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_dossierEtapeId_fkey` FOREIGN KEY (`dossierEtapeId`) REFERENCES `DossierEtape`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_modeleTacheEtapeId_fkey` FOREIGN KEY (`modeleTacheEtapeId`) REFERENCES `ModeleTacheEtape`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_regleRelanceId_fkey` FOREIGN KEY (`regleRelanceId`) REFERENCES `RegleRelance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegleRelance` ADD CONSTRAINT `RegleRelance_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Programme` ADD CONSTRAINT `Programme_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProgrammeVersion` ADD CONSTRAINT `ProgrammeVersion_programmeId_fkey` FOREIGN KEY (`programmeId`) REFERENCES `Programme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtapeProgramme` ADD CONSTRAINT `EtapeProgramme_programmeVersionId_fkey` FOREIGN KEY (`programmeVersionId`) REFERENCES `ProgrammeVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtapeDependance` ADD CONSTRAINT `EtapeDependance_etapeId_fkey` FOREIGN KEY (`etapeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtapeDependance` ADD CONSTRAINT `EtapeDependance_dependsOnEtapeId_fkey` FOREIGN KEY (`dependsOnEtapeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtapeDocumentRequis` ADD CONSTRAINT `EtapeDocumentRequis_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModeleTacheEtape` ADD CONSTRAINT `ModeleTacheEtape_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegleReglementaireVersion` ADD CONSTRAINT `RegleReglementaireVersion_regleId_fkey` FOREIGN KEY (`regleId`) REFERENCES `RegleReglementaire`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BaremeReglementaire` ADD CONSTRAINT `BaremeReglementaire_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `RegleReglementaireVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_posteTravauxId_fkey` FOREIGN KEY (`posteTravauxId`) REFERENCES `DossierPosteTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `RegleReglementaireVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_overrideById_fkey` FOREIGN KEY (`overrideById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculReglementaire` ADD CONSTRAINT `CalculReglementaire_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TarifDelegataireCee` ADD CONSTRAINT `TarifDelegataireCee_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TarifDelegataireCee` ADD CONSTRAINT `TarifDelegataireCee_delegataireId_fkey` FOREIGN KEY (`delegataireId`) REFERENCES `DelegataireCee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtudeDossier` ADD CONSTRAINT `EtudeDossier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtudeDossier` ADD CONSTRAINT `EtudeDossier_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtudeDossier` ADD CONSTRAINT `EtudeDossier_selectedById_fkey` FOREIGN KEY (`selectedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EtudeDossier` ADD CONSTRAINT `EtudeDossier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultatAppel` ADD CONSTRAINT `ResultatAppel_proposeStatutId_fkey` FOREIGN KEY (`proposeStatutId`) REFERENCES `LeadPipelineStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `LeadSource`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_commercialId_fkey` FOREIGN KEY (`commercialId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_teleprospecteurId_fkey` FOREIGN KEY (`teleprospecteurId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_statutId_fkey` FOREIGN KEY (`statutId`) REFERENCES `LeadPipelineStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_dernierResultatId_fkey` FOREIGN KEY (`dernierResultatId`) REFERENCES `ResultatAppel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_claimedById_fkey` FOREIGN KEY (`claimedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadStatusHistory` ADD CONSTRAINT `LeadStatusHistory_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadStatusHistory` ADD CONSTRAINT `LeadStatusHistory_oldStatusId_fkey` FOREIGN KEY (`oldStatusId`) REFERENCES `LeadPipelineStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadStatusHistory` ADD CONSTRAINT `LeadStatusHistory_newStatusId_fkey` FOREIGN KEY (`newStatusId`) REFERENCES `LeadPipelineStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadStatusHistory` ADD CONSTRAINT `LeadStatusHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Logement` ADD CONSTRAINT `Logement_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Logement` ADD CONSTRAINT `Logement_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Logement` ADD CONSTRAINT `Logement_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Logement` ADD CONSTRAINT `Logement_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChampProvenance` ADD CONSTRAINT `ChampProvenance_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChampProvenance` ADD CONSTRAINT `ChampProvenance_logementId_fkey` FOREIGN KEY (`logementId`) REFERENCES `Logement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChampProvenance` ADD CONSTRAINT `ChampProvenance_accepteeById_fkey` FOREIGN KEY (`accepteeById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Questionnaire` ADD CONSTRAINT `Questionnaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuestionnaireVersion` ADD CONSTRAINT `QuestionnaireVersion_questionnaireId_fkey` FOREIGN KEY (`questionnaireId`) REFERENCES `Questionnaire`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Question` ADD CONSTRAINT `Question_questionnaireVersionId_fkey` FOREIGN KEY (`questionnaireVersionId`) REFERENCES `QuestionnaireVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OptionQuestion` ADD CONSTRAINT `OptionQuestion_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `Question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConditionQuestion` ADD CONSTRAINT `ConditionQuestion_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `Question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConditionQuestion` ADD CONSTRAINT `ConditionQuestion_questionDeclenchanteId_fkey` FOREIGN KEY (`questionDeclenchanteId`) REFERENCES `Question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestionnaire` ADD CONSTRAINT `ReponseQuestionnaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestionnaire` ADD CONSTRAINT `ReponseQuestionnaire_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestionnaire` ADD CONSTRAINT `ReponseQuestionnaire_questionnaireVersionId_fkey` FOREIGN KEY (`questionnaireVersionId`) REFERENCES `QuestionnaireVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestion` ADD CONSTRAINT `ReponseQuestion_reponseQuestionnaireId_fkey` FOREIGN KEY (`reponseQuestionnaireId`) REFERENCES `ReponseQuestionnaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestion` ADD CONSTRAINT `ReponseQuestion_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `Question`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionCommerciale` ADD CONSTRAINT `InteractionCommerciale_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionCommerciale` ADD CONSTRAINT `InteractionCommerciale_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionCommerciale` ADD CONSTRAINT `InteractionCommerciale_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionCommerciale` ADD CONSTRAINT `InteractionCommerciale_resultatId_fkey` FOREIGN KEY (`resultatId`) REFERENCES `ResultatAppel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rdv` ADD CONSTRAINT `Rdv_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rdv` ADD CONSTRAINT `Rdv_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rdv` ADD CONSTRAINT `Rdv_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rdv` ADD CONSTRAINT `Rdv_commercialId_fkey` FOREIGN KEY (`commercialId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rdv` ADD CONSTRAINT `Rdv_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRule` ADD CONSTRAINT `AutomationRule_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRule` ADD CONSTRAINT `AutomationRule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationExecution` ADD CONSTRAINT `AutomationExecution_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `AutomationRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationExecution` ADD CONSTRAINT `AutomationExecution_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailDraft` ADD CONSTRAINT `EmailDraft_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailDraft` ADD CONSTRAINT `EmailDraft_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `EmailTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailDraft` ADD CONSTRAINT `EmailDraft_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailDraft` ADD CONSTRAINT `EmailDraft_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailDraft` ADD CONSTRAINT `EmailDraft_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailSendLog` ADD CONSTRAINT `EmailSendLog_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailSendLog` ADD CONSTRAINT `EmailSendLog_draftId_fkey` FOREIGN KEY (`draftId`) REFERENCES `EmailDraft`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailSendLog` ADD CONSTRAINT `EmailSendLog_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailSendLog` ADD CONSTRAINT `EmailSendLog_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailSendLog` ADD CONSTRAINT `EmailSendLog_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookEndpoint` ADD CONSTRAINT `WebhookEndpoint_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_endpointId_fkey` FOREIGN KEY (`endpointId`) REFERENCES `WebhookEndpoint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

