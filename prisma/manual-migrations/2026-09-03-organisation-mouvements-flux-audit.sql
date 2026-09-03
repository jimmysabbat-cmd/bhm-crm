-- ============================================================
-- BHM CRM — socle SaaS : Organisation (multi-tenant), mouvements
-- financiers datés, flux CEE/Travaux indépendants, journal d'audit.
--
-- Additive et sûre même avec des dossiers réels déjà en base :
-- organisationId est d'abord ajouté en NULL sur User/Client/Dossier,
-- rempli via l'organisation "BHM" créée à l'étape 2, et ce n'est
-- qu'ensuite qu'il devient obligatoire. Si une étape échoue, RIEN
-- n'est perdu (les colonnes sont encore nullable) : dans ce cas,
-- s'arrêter et vérifier avant de continuer.
-- ============================================================

-- 1) Nouvelles tables
CREATE TABLE `Organisation` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Organisation_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `MouvementFinancier` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('ENTREE', 'SORTIE') NOT NULL,
    `categorie` ENUM('ENCAISSEMENT_CLIENT', 'ENCAISSEMENT_ANAH', 'ENCAISSEMENT_MPR', 'ENCAISSEMENT_CEE', 'PAIEMENT_SOUS_TRAITANT', 'PAIEMENT_FOURNISSEUR', 'COMMISSION_COMMERCIALE', 'COMMISSION_REGIE', 'COMMISSION_APPORTEUR', 'AUTRE_ENTREE', 'AUTRE_SORTIE') NOT NULL,
    `payeur` VARCHAR(191) NULL,
    `beneficiaire` VARCHAR(191) NULL,
    `montantPrevuCts` INTEGER NULL,
    `montantReelCts` INTEGER NULL,
    `datePrevue` DATETIME(3) NULL,
    `dateReelle` DATETIME(3) NULL,
    `statut` ENUM('PREVU', 'A_RECEVOIR', 'A_PAYER', 'PARTIEL', 'RECU', 'PAYE', 'ANNULE', 'EN_RETARD') NOT NULL DEFAULT 'PREVU',
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

-- 2) Organisation par défaut (l'entreprise BHM actuelle)
INSERT INTO `Organisation` (`id`, `nom`, `slug`, `updatedAt`) VALUES
  ('org-bhm', 'Le Bonheur d''Habiter Mieux', 'bhm', CURRENT_TIMESTAMP(3));

-- Statuts CEE et Travaux : démarrent vides, à créer par l'admin depuis
-- /parametrage (mêmes principes que StatutAnah, pas de valeurs figées
-- imposées par le code).

-- 3) Nouvelles colonnes nullable sur les tables existantes
ALTER TABLE `User` ADD COLUMN `organisationId` VARCHAR(191) NULL;
ALTER TABLE `Client` ADD COLUMN `organisationId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `organisationId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `statutCeeId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `statutTravauxId` VARCHAR(191) NULL;

-- 4) Rattachement de toutes les données existantes à l'organisation BHM
UPDATE `User` SET `organisationId` = 'org-bhm' WHERE `organisationId` IS NULL;
UPDATE `Client` SET `organisationId` = 'org-bhm' WHERE `organisationId` IS NULL;
UPDATE `Dossier` SET `organisationId` = 'org-bhm' WHERE `organisationId` IS NULL;

-- 5) organisationId devient obligatoire (échoue proprement si une ligne
--    n'a pas pu être rattachée à l'étape 4 — dans ce cas, RIEN n'est
--    perdu, s'arrêter ici et vérifier avant de continuer)
ALTER TABLE `User` MODIFY `organisationId` VARCHAR(191) NOT NULL;
ALTER TABLE `Client` MODIFY `organisationId` VARCHAR(191) NOT NULL;
ALTER TABLE `Dossier` MODIFY `organisationId` VARCHAR(191) NOT NULL;

-- 6) Rôles supplémentaires (additif : ADMIN/COMMERCIAL/COMPTA existants
--    conservés tels quels, rien ne change pour les comptes déjà créés)
ALTER TABLE `User` MODIFY `role` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE') NOT NULL DEFAULT 'COMMERCIAL';

-- 7) Index + clés étrangères
CREATE INDEX `User_organisationId_idx` ON `User`(`organisationId`);
CREATE INDEX `Client_organisationId_idx` ON `Client`(`organisationId`);
CREATE INDEX `Dossier_organisationId_idx` ON `Dossier`(`organisationId`);
CREATE INDEX `Dossier_statutCeeId_idx` ON `Dossier`(`statutCeeId`);
CREATE INDEX `Dossier_statutTravauxId_idx` ON `Dossier`(`statutTravauxId`);

ALTER TABLE `User` ADD CONSTRAINT `User_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Client` ADD CONSTRAINT `Client_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutCeeId_fkey` FOREIGN KEY (`statutCeeId`) REFERENCES `StatutCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutTravauxId_fkey` FOREIGN KEY (`statutTravauxId`) REFERENCES `StatutTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MouvementFinancier` ADD CONSTRAINT `MouvementFinancier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Non applicable à ce stade (aucune donnée fabriquée) :
-- MouvementFinancier ne reprend PAS automatiquement les compteurs
-- agrégés existants (Dossier.montantEncaisseClient/MPR/CEE...). Une
-- reprise future devra utiliser origine = 'SOURCE_EXISTANTE_AGREGEE'
-- et laisser datePrevue/dateReelle NULL plutôt que d'inventer une date.
-- ============================================================
