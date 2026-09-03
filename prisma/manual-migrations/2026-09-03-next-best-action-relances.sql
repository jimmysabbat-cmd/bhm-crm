-- ============================================================
-- BHM CRM — moteur "Next Best Action" + règles de relance paramétrables.
--
-- Entièrement additive : une nouvelle table (RegleRelance) + quatre
-- nouvelles colonnes nullable/à valeur par défaut sur Tache
-- (derniereRelanceAt, nombreRelances, prochaineRelanceAt, regleRelanceId)
-- + une nouvelle contrainte unique sur Tache(dossierEtapeId, regleRelanceId).
-- Aucune colonne existante modifiée ni supprimée, aucun risque pour les
-- tâches déjà en base : elles héritent de regleRelanceId = NULL, et en
-- MySQL/MariaDB deux lignes NULL ne sont jamais considérées comme
-- dupliquées par une contrainte unique (NULL <> NULL), donc la nouvelle
-- contrainte ne peut pas entrer en conflit avec les tâches existantes.
-- ============================================================

-- 1) Nouvelle table RegleRelance
CREATE TABLE `RegleRelance` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `typeFlux` ENUM('COMMERCIAL', 'ADMINISTRATIF', 'ANAH', 'CEE', 'TRAVAUX', 'FINANCIER', 'AUTRE') NOT NULL,
    `typeAction` VARCHAR(191) NULL,
    `apresJours` INTEGER NOT NULL,
    `recurrenceJours` INTEGER NULL,
    `maxRelances` INTEGER NULL,
    `roleResponsable` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE') NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `RegleRelance_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RegleRelance`
    ADD CONSTRAINT `RegleRelance_organisationId_fkey`
    FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Nouvelles colonnes sur Tache (toutes nullable ou avec DEFAULT — sûr sur
--    une table déjà peuplée, aucune valeur n'est inventée pour les lignes
--    existantes).
ALTER TABLE `Tache`
    ADD COLUMN `derniereRelanceAt` DATETIME(3) NULL,
    ADD COLUMN `nombreRelances` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `prochaineRelanceAt` DATETIME(3) NULL,
    ADD COLUMN `regleRelanceId` VARCHAR(191) NULL;

ALTER TABLE `Tache`
    ADD CONSTRAINT `Tache_regleRelanceId_fkey`
    FOREIGN KEY (`regleRelanceId`) REFERENCES `RegleRelance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Contrainte unique d'idempotence : une même règle de relance ne crée
--    jamais deux tâches pour la même étape de dossier. Sûre par construction
--    (cf. note NULL<>NULL ci-dessus) car toutes les tâches existantes ont
--    regleRelanceId = NULL avant cette migration.
ALTER TABLE `Tache`
    ADD UNIQUE INDEX `Tache_dossierEtapeId_regleRelanceId_key`(`dossierEtapeId`, `regleRelanceId`);

-- ============================================================
-- Vérifications post-migration recommandées (production) :
--   SELECT COUNT(*) FROM `Tache`;                                -- inchangé
--   SELECT COUNT(*) FROM `Tache` WHERE `regleRelanceId` IS NOT NULL; -- = 0 juste après la migration
--   SHOW CREATE TABLE `RegleRelance`;
--   SHOW INDEX FROM `Tache` WHERE Key_name = 'Tache_dossierEtapeId_regleRelanceId_key';
-- ============================================================
