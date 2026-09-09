-- P13 (audit SaaS) - Phase fondation, migration 100% additive :
-- - aucune colonne existante n'est supprimée ou renommée
-- - aucune donnée existante n'est modifiée hors backfill explicite ci-dessous
-- - SousTraitant/DelegataireCee/User.sousTraitantId/User.delegataireCeeId
--   restent intacts et pleinement fonctionnels
-- - RegleReglementaireVersion.publie reste la source de vérité lue par
--   getApplicableRuleVersion()/assertRuleVersionEditable(), inchangée

-- ============================================================
-- A. Admin principal SaaS
-- ============================================================

-- AlterTable
ALTER TABLE `Organisation` ADD COLUMN `principalAdminUserId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User`
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `partenaireId` VARCHAR(191) NULL,
    ADD COLUMN `partenaireFonction` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `User_partenaireId_idx` ON `User`(`partenaireId`);

-- ============================================================
-- B. Gouvernance des fiches réglementaires (additif, `publie` inchangé)
-- ============================================================

-- AlterTable
ALTER TABLE `RegleReglementaireVersion`
    ADD COLUMN `statutValidation` ENUM('BROUILLON', 'A_VERIFIER', 'VALIDE', 'PUBLIE', 'ARCHIVE') NOT NULL DEFAULT 'BROUILLON',
    ADD COLUMN `methodeAlimentation` ENUM('SAISIE_MANUELLE', 'IMPORT_DOCUMENT', 'SYNCHRO_API') NOT NULL DEFAULT 'SAISIE_MANUELLE',
    ADD COLUMN `validatedById` VARCHAR(191) NULL,
    ADD COLUMN `validatedAt` DATETIME(3) NULL;

-- Backfill : une version déjà publiée (publie = true) est réputée PUBLIE au
-- nouveau statut, sans quoi elle deviendrait subitement inutilisable pour un
-- calcul OFFICIEL (assertRuleVersionUsableForOfficial() exige PUBLIE). Une
-- version encore en brouillon (publie = false) reste BROUILLON (valeur par
-- défaut déjà appliquée par l'ADD COLUMN ci-dessus, UPDATE explicite pour
-- ne dépendre d'aucun ordre d'exécution implicite).
UPDATE `RegleReglementaireVersion` SET `statutValidation` = 'PUBLIE' WHERE `publie` = true;
UPDATE `RegleReglementaireVersion` SET `statutValidation` = 'BROUILLON' WHERE `publie` = false;

-- ============================================================
-- C. Flux programme (additif - aucune valeur existante ne change de sens)
-- ============================================================

-- AlterTable
ALTER TABLE `EtapeProgramme` MODIFY COLUMN `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'TECHNIQUE', 'MATERIEL', 'PRODUCTION', 'AUTRE') NOT NULL DEFAULT 'AUTRE';

-- AlterTable
ALTER TABLE `RegleRelance` MODIFY COLUMN `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'TECHNIQUE', 'MATERIEL', 'PRODUCTION', 'AUTRE') NOT NULL;

-- ============================================================
-- D. Moteur de gates / conditions externes
-- ============================================================

-- CreateTable
CREATE TABLE `EtapeCondition` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `type` ENUM('DEPENDANCE_ETAPE', 'DOCUMENT_REQUIS', 'STATUT_EXTERNE', 'VALIDATION_INTERVENANT') NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `dependsOnEtapeId` VARCHAR(191) NULL,
    `documentRequirementId` VARCHAR(191) NULL,
    `statutExterneCle` VARCHAR(191) NULL,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NULL,
    `partenaireRoleResponsable` ENUM('SOUS_TRAITANT', 'DELEGATAIRE_CEE', 'REGIE_COMMERCIALE', 'DONNEUR_ORDRE', 'MANDATAIRE', 'FOURNISSEUR', 'AUTRE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `bloquant` BOOLEAN NOT NULL DEFAULT true,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EtapeCondition_etapeProgrammeId_idx`(`etapeProgrammeId`),
    INDEX `EtapeCondition_dependsOnEtapeId_idx`(`dependsOnEtapeId`),
    INDEX `EtapeCondition_documentRequirementId_idx`(`documentRequirementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierEtapeConditionValidation` (
    `id` VARCHAR(191) NOT NULL,
    `etapeConditionId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `satisfiedAt` DATETIME(3) NULL,
    `satisfiedById` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DossierEtapeConditionValidation_etapeConditionId_dossierId_key`(`etapeConditionId`, `dossierId`),
    INDEX `DossierEtapeConditionValidation_dossierId_idx`(`dossierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- E. Partenaire générique (transitoire/additif)
-- ============================================================

-- CreateTable
CREATE TABLE `Partenaire` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `telephone` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Partenaire_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartenaireRole` (
    `id` VARCHAR(191) NOT NULL,
    `partenaireId` VARCHAR(191) NOT NULL,
    `role` ENUM('SOUS_TRAITANT', 'DELEGATAIRE_CEE', 'REGIE_COMMERCIALE', 'DONNEUR_ORDRE', 'MANDATAIRE', 'FOURNISSEUR', 'AUTRE') NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PartenaireRole_partenaireId_role_key`(`partenaireId`, `role`),
    INDEX `PartenaireRole_partenaireId_idx`(`partenaireId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartenaireCapability` (
    `id` VARCHAR(191) NOT NULL,
    `partenaireId` VARCHAR(191) NOT NULL,
    `cle` ENUM('CREER_LEAD', 'PRENDRE_RDV', 'QUALIFIER', 'COLLECTER_DOCUMENTS', 'MODIFIER_TECHNIQUE', 'CREER_DEVIS', 'SIGNATURE', 'TRANSMETTRE_DOSSIER', 'VOIR_PLANNING', 'VOIR_FACTURATION', 'AUTRE') NOT NULL,
    `activee` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PartenaireCapability_partenaireId_cle_key`(`partenaireId`, `cle`),
    INDEX `PartenaireCapability_partenaireId_idx`(`partenaireId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (liens transitoires nullables 1:1 - aucune donnée existante touchée)
ALTER TABLE `SousTraitant` ADD COLUMN `partenaireId` VARCHAR(191) NULL;
ALTER TABLE `DelegataireCee` ADD COLUMN `partenaireId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `SousTraitant_partenaireId_key` ON `SousTraitant`(`partenaireId`);
CREATE UNIQUE INDEX `DelegataireCee_partenaireId_key` ON `DelegataireCee`(`partenaireId`);

-- ============================================================
-- Foreign Keys
-- ============================================================

ALTER TABLE `Organisation` ADD CONSTRAINT `Organisation_principalAdminUserId_fkey` FOREIGN KEY (`principalAdminUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `User` ADD CONSTRAINT `User_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RegleReglementaireVersion` ADD CONSTRAINT `RegleReglementaireVersion_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EtapeCondition` ADD CONSTRAINT `EtapeCondition_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EtapeCondition` ADD CONSTRAINT `EtapeCondition_dependsOnEtapeId_fkey` FOREIGN KEY (`dependsOnEtapeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `EtapeCondition` ADD CONSTRAINT `EtapeCondition_documentRequirementId_fkey` FOREIGN KEY (`documentRequirementId`) REFERENCES `DocumentRequirement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_etapeConditionId_fkey` FOREIGN KEY (`etapeConditionId`) REFERENCES `EtapeCondition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_satisfiedById_fkey` FOREIGN KEY (`satisfiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Partenaire` ADD CONSTRAINT `Partenaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PartenaireRole` ADD CONSTRAINT `PartenaireRole_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PartenaireCapability` ADD CONSTRAINT `PartenaireCapability_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SousTraitant` ADD CONSTRAINT `SousTraitant_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DelegataireCee` ADD CONSTRAINT `DelegataireCee_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
