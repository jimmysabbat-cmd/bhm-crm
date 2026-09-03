-- ============================================================
-- BHM CRM — moteur réglementaire versionné + CEE (P7).
--
-- Entièrement additif : 3 nouveaux enums, 5 nouvelles tables (règles
-- réglementaires globales + calculs + tarifs délégataires organisation-
-- scopés), et 2 nouvelles colonnes nullable sur DossierPosteTravaux
-- (ficheReglementaireCode, calculReglementaireActifId, avec une contrainte
-- UNIQUE sur cette dernière). Aucune colonne existante modifiée ni
-- supprimée : montantCumac/montantPrimeCalculeCts restent la source
-- utilisée par l'ancien calculateur CeeCumacCalculator.tsx, qui continue
-- de fonctionner sans changement. Le nouveau moteur fonctionne en
-- parallèle (section 33 du prompt P7).
-- ============================================================

-- 1) Nouvelles colonnes sur DossierPosteTravaux (nullable, sûres sur une
--    table déjà peuplée) - les nouveaux enums (SecteurReglementaire,
--    StatutEligibiliteReglementaire, TypeCalculReglementaire) sont définis
--    inline par MySQL sur les colonnes qui les utilisent ci-dessous, il n'y
--    a pas de type enum nommé séparé à créer.
ALTER TABLE `DossierPosteTravaux`
  ADD COLUMN `ficheReglementaireCode` VARCHAR(191) NULL,
  ADD COLUMN `calculReglementaireActifId` VARCHAR(191) NULL;

-- 2) Nouvelles tables

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
    UNIQUE INDEX `RegleReglementaireVersion_regleId_numeroVersion_key`(`regleId`, `numeroVersion`),
    INDEX `RegleReglementaireVersion_regleId_idx`(`regleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BaremeReglementaire` (
    `id` VARCHAR(191) NOT NULL,
    `ruleVersionId` VARCHAR(191) NOT NULL,
    `cle` VARCHAR(191) NOT NULL,
    `valeur` INTEGER NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `BaremeReglementaire_ruleVersionId_cle_key`(`ruleVersionId`, `cle`),
    INDEX `BaremeReglementaire_ruleVersionId_idx`(`ruleVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- 3) Contrainte unique sur le pointeur "calcul actif" du poste (une seule
--    poste par calcul actif) - sûre car toutes les lignes existantes ont
--    calculReglementaireActifId = NULL (NULL <> NULL en MySQL/MariaDB).
ALTER TABLE `DossierPosteTravaux`
  ADD UNIQUE INDEX `DossierPosteTravaux_calculReglementaireActifId_key`(`calculReglementaireActifId`);

-- 4) Clés étrangères
ALTER TABLE `RegleReglementaireVersion`
  ADD CONSTRAINT `RegleReglementaireVersion_regleId_fkey` FOREIGN KEY (`regleId`) REFERENCES `RegleReglementaire`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BaremeReglementaire`
  ADD CONSTRAINT `BaremeReglementaire_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `RegleReglementaireVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CalculReglementaire`
  ADD CONSTRAINT `CalculReglementaire_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CalculReglementaire_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `CalculReglementaire_posteTravauxId_fkey` FOREIGN KEY (`posteTravauxId`) REFERENCES `DossierPosteTravaux`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CalculReglementaire_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `RegleReglementaireVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CalculReglementaire_overrideById_fkey` FOREIGN KEY (`overrideById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CalculReglementaire_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TarifDelegataireCee`
  ADD CONSTRAINT `TarifDelegataireCee_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `TarifDelegataireCee_delegataireId_fkey` FOREIGN KEY (`delegataireId`) REFERENCES `DelegataireCee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DossierPosteTravaux`
  ADD CONSTRAINT `DossierPosteTravaux_calculReglementaireActifId_fkey` FOREIGN KEY (`calculReglementaireActifId`) REFERENCES `CalculReglementaire`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Seed obligatoire après cette migration : la fiche pilote BAR-TH-171
--    (règle + version + 18 valeurs de barème, reprises telles quelles de
--    l'ancien calculateur CeeCumacCalculator.tsx) - cf. prisma/seed-reglementaire.ts,
--    appelée automatiquement par `npx prisma db seed`.

-- ============================================================
-- Vérifications post-migration recommandées (production) :
--   SELECT COUNT(*) FROM `DossierPosteTravaux`;                        -- inchangé
--   SELECT COUNT(*) FROM `DossierPosteTravaux` WHERE `calculReglementaireActifId` IS NOT NULL; -- = 0 juste après
--   SELECT * FROM `RegleReglementaire`;                                -- devrait être vide avant le seed
--   SHOW INDEX FROM `DossierPosteTravaux` WHERE Key_name LIKE '%calculReglementaireActifId%';
-- ============================================================
