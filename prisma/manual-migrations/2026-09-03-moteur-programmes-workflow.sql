-- ============================================================
-- BHM CRM — moteur de programmes/workflows paramétrables.
--
-- Entièrement additive : nouvelles tables + deux nouvelles colonnes
-- nullable (Dossier.programmeVersionId, Tache.dossierEtapeId,
-- Tache.modeleTacheEtapeId). Aucune colonne existante modifiée ni
-- supprimée, aucun risque pour les dossiers déjà en base (ils héritent
-- simplement de programmeVersionId = NULL, comme prévu par le schéma).
-- ============================================================

-- 1) Nouvelles tables
CREATE TABLE `Programme` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Programme_organisationId_code_key`(`organisationId`, `code`),
    INDEX `Programme_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    UNIQUE INDEX `ProgrammeVersion_programmeId_numeroVersion_key`(`programmeId`, `numeroVersion`),
    INDEX `ProgrammeVersion_programmeId_idx`(`programmeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `EtapeProgramme_programmeVersionId_code_key`(`programmeVersionId`, `code`),
    INDEX `EtapeProgramme_programmeVersionId_idx`(`programmeVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EtapeDependance` (
    `id` VARCHAR(191) NOT NULL,
    `etapeId` VARCHAR(191) NOT NULL,
    `dependsOnEtapeId` VARCHAR(191) NOT NULL,
    `type` ENUM('ALL_COMPLETED') NOT NULL DEFAULT 'ALL_COMPLETED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `EtapeDependance_etapeId_dependsOnEtapeId_key`(`etapeId`, `dependsOnEtapeId`),
    INDEX `EtapeDependance_etapeId_idx`(`etapeId`),
    INDEX `EtapeDependance_dependsOnEtapeId_idx`(`dependsOnEtapeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EtapeDocumentRequis` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `typeDocument` ENUM('DEVIS', 'AUDIT', 'PHOTO_VISITE', 'PHOTO_CHANTIER', 'AUTRE') NOT NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `EtapeDocumentRequis_etapeProgrammeId_typeDocument_key`(`etapeProgrammeId`, `typeDocument`),
    INDEX `EtapeDocumentRequis_etapeProgrammeId_idx`(`etapeProgrammeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ModeleTacheEtape` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `titre` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `type` ENUM('RELANCE_CLIENT', 'RELANCE_CEE', 'RELANCE_ANAH', 'RELANCE_FOURNISSEUR', 'RELANCE_SOUS_TRAITANT', 'AUTRE') NOT NULL DEFAULT 'AUTRE',
    `delaiJours` INTEGER NOT NULL DEFAULT 0,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ModeleTacheEtape_etapeProgrammeId_idx`(`etapeProgrammeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    UNIQUE INDEX `DossierEtape_dossierId_etapeProgrammeId_key`(`dossierId`, `etapeProgrammeId`),
    INDEX `DossierEtape_organisationId_idx`(`organisationId`),
    INDEX `DossierEtape_dossierId_idx`(`dossierId`),
    INDEX `DossierEtape_etapeProgrammeId_idx`(`etapeProgrammeId`),
    INDEX `DossierEtape_statut_idx`(`statut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) Nouvelles colonnes nullable sur les tables existantes
ALTER TABLE `Dossier` ADD COLUMN `programmeVersionId` VARCHAR(191) NULL;
ALTER TABLE `Tache` ADD COLUMN `dossierEtapeId` VARCHAR(191) NULL;
ALTER TABLE `Tache` ADD COLUMN `modeleTacheEtapeId` VARCHAR(191) NULL;

-- Idempotence des tâches auto-générées : (dossierEtapeId, modeleTacheEtapeId)
-- ne peut exister qu'une fois. Sans danger sur les tâches existantes : NULL
-- n'est jamais considéré égal à NULL par un index unique MySQL/MariaDB.
CREATE UNIQUE INDEX `Tache_dossierEtapeId_modeleTacheEtapeId_key` ON `Tache`(`dossierEtapeId`, `modeleTacheEtapeId`);

-- 3) Index + clés étrangères
CREATE INDEX `Dossier_programmeVersionId_idx` ON `Dossier`(`programmeVersionId`);

ALTER TABLE `Programme` ADD CONSTRAINT `Programme_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProgrammeVersion` ADD CONSTRAINT `ProgrammeVersion_programmeId_fkey` FOREIGN KEY (`programmeId`) REFERENCES `Programme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EtapeProgramme` ADD CONSTRAINT `EtapeProgramme_programmeVersionId_fkey` FOREIGN KEY (`programmeVersionId`) REFERENCES `ProgrammeVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EtapeDependance` ADD CONSTRAINT `EtapeDependance_etapeId_fkey` FOREIGN KEY (`etapeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EtapeDependance` ADD CONSTRAINT `EtapeDependance_dependsOnEtapeId_fkey` FOREIGN KEY (`dependsOnEtapeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EtapeDocumentRequis` ADD CONSTRAINT `EtapeDocumentRequis_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ModeleTacheEtape` ADD CONSTRAINT `ModeleTacheEtape_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DossierEtape` ADD CONSTRAINT `DossierEtape_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_programmeVersionId_fkey` FOREIGN KEY (`programmeVersionId`) REFERENCES `ProgrammeVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_dossierEtapeId_fkey` FOREIGN KEY (`dossierEtapeId`) REFERENCES `DossierEtape`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Tache` ADD CONSTRAINT `Tache_modeleTacheEtapeId_fkey` FOREIGN KEY (`modeleTacheEtapeId`) REFERENCES `ModeleTacheEtape`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Le programme de démonstration ("Rénovation d'ampleur ANAH" v2026.1,
-- 20 étapes) est créé par prisma/seed.ts, pas par ce script - relancer
-- le seed après cette migration pour le faire apparaître en prod.
-- ============================================================
