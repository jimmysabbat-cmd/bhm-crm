-- P13 - Phase fondation SaaS (audit validé, migration finale unique -
-- squash de deux migrations provisoires jamais déployées, cf. revue avant
-- figeage du modèle). Additif uniquement :
-- - aucune colonne existante n'est supprimée/renommée
-- - `publie` (RegleReglementaireVersion) reste inchangé, seule source de
--   vérité lue par getApplicableRuleVersion()/assertRuleVersionEditable()
-- - SousTraitant/DelegataireCee/User.sousTraitantId/User.delegataireCeeId
--   restent intacts et pleinement fonctionnels (transition Partenaire
--   additive et transitoire)
-- - EtapeDependance et DocumentRequirement restent les seules sources de
--   vérité pour les dépendances étape-à-étape et les exigences
--   documentaires - EtapeCondition ne les duplique jamais.

-- ============================================================
-- A. Admin principal SaaS
-- ============================================================

ALTER TABLE `Organisation` ADD COLUMN `principalAdminUserId` VARCHAR(191) NULL;

ALTER TABLE `User`
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `partenaireId` VARCHAR(191) NULL,
    ADD COLUMN `partenaireFonction` VARCHAR(191) NULL;

CREATE INDEX `User_partenaireId_idx` ON `User`(`partenaireId`);

-- ============================================================
-- B. Gouvernance des fiches réglementaires (additif, `publie` inchangé)
-- ============================================================

ALTER TABLE `RegleReglementaireVersion`
    ADD COLUMN `statutValidation` ENUM('BROUILLON', 'A_VERIFIER', 'VALIDE', 'PUBLIE', 'ARCHIVE') NOT NULL DEFAULT 'BROUILLON',
    ADD COLUMN `methodeAlimentation` ENUM('SAISIE_MANUELLE', 'IMPORT_DOCUMENT', 'SYNCHRO_API') NOT NULL DEFAULT 'SAISIE_MANUELLE',
    ADD COLUMN `validatedById` VARCHAR(191) NULL,
    ADD COLUMN `validatedAt` DATETIME(3) NULL;

-- Backfill : une version déjà publiée (publie = true) est réputée PUBLIE au
-- nouveau statut, sans quoi elle deviendrait subitement inutilisable pour un
-- calcul OFFICIEL (assertRuleVersionUsableForOfficial() exige PUBLIE).
UPDATE `RegleReglementaireVersion` SET `statutValidation` = 'PUBLIE' WHERE `publie` = true;
UPDATE `RegleReglementaireVersion` SET `statutValidation` = 'BROUILLON' WHERE `publie` = false;

-- ============================================================
-- C. Flux programme (additif - aucune valeur existante ne change de sens)
-- ============================================================

ALTER TABLE `EtapeProgramme` MODIFY COLUMN `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'TECHNIQUE', 'MATERIEL', 'PRODUCTION', 'AUTRE') NOT NULL DEFAULT 'AUTRE';
ALTER TABLE `RegleRelance` MODIFY COLUMN `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'TECHNIQUE', 'MATERIEL', 'PRODUCTION', 'AUTRE') NOT NULL;

-- ============================================================
-- D. Moteur de gates / conditions externes (modèle final révisé) -
-- ETAPE/DOCUMENT sont volontairement absents : une dépendance étape-à-étape
-- reste EtapeDependance, une exigence documentaire reste DocumentRequirement,
-- jamais dupliquées ici. EtapeCondition ne couvre que DONNEE_DOSSIER (clé
-- ENUM typée, jamais une chaîne libre) et VALIDATION_INTERVENANT.
-- ============================================================

CREATE TABLE `EtapeCondition` (
    `id` VARCHAR(191) NOT NULL,
    `etapeProgrammeId` VARCHAR(191) NOT NULL,
    `type` ENUM('DONNEE_DOSSIER', 'VALIDATION_INTERVENANT') NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `donneeDossierCle` ENUM('ANAH_DEPOT_EFFECTUE', 'ANAH_ACCORD_RECU', 'ANAH_STATUT_RENSEIGNE', 'CEE_STATUT_RENSEIGNE', 'TRAVAUX_STATUT_RENSEIGNE', 'TRAVAUX_DEMARRES', 'TRAVAUX_TERMINES') NULL,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE') NULL,
    `partenaireRoleResponsable` ENUM('SOUS_TRAITANT', 'DELEGATAIRE_CEE', 'REGIE_COMMERCIALE', 'DONNEUR_ORDRE', 'MANDATAIRE', 'FOURNISSEUR', 'AUTRE') NULL,
    `obligatoire` BOOLEAN NOT NULL DEFAULT true,
    `bloquant` BOOLEAN NOT NULL DEFAULT true,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EtapeCondition_etapeProgrammeId_idx`(`etapeProgrammeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DossierEtapeConditionValidation` (
    `id` VARCHAR(191) NOT NULL,
    `etapeConditionId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `satisfiedAt` DATETIME(3) NULL,
    `satisfiedById` VARCHAR(191) NULL,
    `preuveDocumentId` VARCHAR(191) NULL,
    `preuveReference` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DossierEtapeConditionValidation_etapeConditionId_dossierId_key`(`etapeConditionId`, `dossierId`),
    INDEX `DossierEtapeConditionValidation_dossierId_idx`(`dossierId`),
    INDEX `DossierEtapeConditionValidation_preuveDocumentId_idx`(`preuveDocumentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- E. Partenaire générique (transitoire/additif)
-- ============================================================

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

ALTER TABLE `SousTraitant` ADD COLUMN `partenaireId` VARCHAR(191) NULL;
ALTER TABLE `DelegataireCee` ADD COLUMN `partenaireId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `SousTraitant_partenaireId_key` ON `SousTraitant`(`partenaireId`);
CREATE UNIQUE INDEX `DelegataireCee_partenaireId_key` ON `DelegataireCee`(`partenaireId`);

-- ============================================================
-- Foreign Keys
-- ============================================================

ALTER TABLE `Organisation` ADD CONSTRAINT `Organisation_principalAdminUserId_fkey` FOREIGN KEY (`principalAdminUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `User` ADD CONSTRAINT `User_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RegleReglementaireVersion` ADD CONSTRAINT `RegleReglementaireVersion_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EtapeCondition` ADD CONSTRAINT `EtapeCondition_etapeProgrammeId_fkey` FOREIGN KEY (`etapeProgrammeId`) REFERENCES `EtapeProgramme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_etapeConditionId_fkey` FOREIGN KEY (`etapeConditionId`) REFERENCES `EtapeCondition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_satisfiedById_fkey` FOREIGN KEY (`satisfiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DossierEtapeConditionValidation` ADD CONSTRAINT `DossierEtapeConditionValidation_preuveDocumentId_fkey` FOREIGN KEY (`preuveDocumentId`) REFERENCES `DossierDocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Partenaire` ADD CONSTRAINT `Partenaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PartenaireRole` ADD CONSTRAINT `PartenaireRole_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PartenaireCapability` ADD CONSTRAINT `PartenaireCapability_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SousTraitant` ADD CONSTRAINT `SousTraitant_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DelegataireCee` ADD CONSTRAINT `DelegataireCee_partenaireId_fkey` FOREIGN KEY (`partenaireId`) REFERENCES `Partenaire`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
