-- ============================================================
-- BHM CRM — migration production : listes paramétrables
-- (types de dossier, statuts, modes de paiement) + comptes équipe
--
-- Sûre même si la table Dossier contient déjà des dossiers réels :
-- les nouvelles colonnes sont d'abord ajoutées en NULL, puis
-- remplies à partir des anciennes valeurs, et ce n'est qu'ensuite
-- qu'elles deviennent obligatoires et que les anciennes colonnes
-- sont supprimées. Si l'étape 5 échoue, aucune donnée n'est perdue
-- (les anciennes colonnes sont encore là) : dans ce cas, s'arrêter
-- et vérifier quel dossier a une valeur type/statut non reconnue
-- avant de continuer.
-- ============================================================

-- 1) Nouvelles tables de paramétrage
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

-- 2) Peuplement (mêmes clés que les anciens enums -> correspondance garantie)
INSERT INTO `DossierType` (`id`, `key`, `label`, `ordre`) VALUES
  ('type-anah', 'RENOVATION_AMPLEUR_ANAH', 'Rénovation d''ampleur (ANAH)', 0),
  ('type-cee', 'RENOVATION_AMPLEUR_CEE', 'Rénovation d''ampleur (CEE seul)', 1),
  ('type-monogeste', 'MONOGESTE', 'Monogeste', 2);

INSERT INTO `DossierStatus` (`id`, `key`, `label`, `ordre`) VALUES
  ('status-devis-signe', 'DEVIS_SIGNE', 'Devis signé', 0),
  ('status-audit-fait', 'AUDIT_FAIT', 'Audit fait', 1),
  ('status-dossier-depose', 'DOSSIER_DEPOSE', 'Dossier déposé', 2),
  ('status-en-instruction', 'EN_INSTRUCTION', 'En instruction', 3),
  ('status-accepte', 'ACCEPTE', 'Accepté', 4),
  ('status-refuse', 'REFUSE', 'Refusé', 5),
  ('status-travaux-planifies', 'TRAVAUX_PLANIFIES', 'Travaux planifiés', 6),
  ('status-travaux-en-cours', 'TRAVAUX_EN_COURS', 'Travaux en cours', 7),
  ('status-travaux-termines', 'TRAVAUX_TERMINES', 'Travaux terminés', 8),
  ('status-controle-en-cours', 'CONTROLE_EN_COURS', 'Contrôle en cours', 9),
  ('status-solde-demande', 'SOLDE_DEMANDE', 'Solde demandé', 10),
  ('status-solde-recu', 'SOLDE_RECU', 'Solde reçu', 11),
  ('status-cloture', 'CLOTURE', 'Clôturé', 12);

INSERT INTO `ModePaiement` (`id`, `key`, `label`, `ordre`) VALUES
  ('mode-client-avance', 'CLIENT_AVANCE', 'Client avance', 0),
  ('mode-avance-30-anah', 'AVANCE_30_ANAH', 'Avance 30% ANAH', 1),
  ('mode-financement-partenaire', 'FINANCEMENT_PARTENAIRE', 'Financement partenaire', 2),
  ('mode-mandataire-bhm', 'MANDATAIRE_FINANCIER_BHM', 'Mandataire BHM', 3),
  ('mode-mandataire-anah', 'MANDATAIRE_FINANCIER_ANAH', 'Mandataire financier ANAH', 4);

-- 3) Nouvelles colonnes FK sur Dossier (nullable pour l'instant)
ALTER TABLE `Dossier` ADD COLUMN `typeId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `statutId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `modePaiementAideId` VARCHAR(191) NULL;

-- 4) Report des valeurs existantes vers les nouvelles clés (no-op si la table est vide)
UPDATE `Dossier` d JOIN `DossierType` t ON t.`key` = d.`type` SET d.`typeId` = t.`id`;
UPDATE `Dossier` d JOIN `DossierStatus` s ON s.`key` = d.`statut` SET d.`statutId` = s.`id`;
UPDATE `Dossier` d JOIN `ModePaiement` m ON m.`key` = d.`modePaiementAide` SET d.`modePaiementAideId` = m.`id`;

-- 5) typeId/statutId deviennent obligatoires (échoue proprement si un dossier
--    n'a pas pu être rattaché à l'étape 4 — dans ce cas, RIEN n'est perdu,
--    s'arrêter ici et vérifier les dossiers concernés avant de continuer)
ALTER TABLE `Dossier` MODIFY `typeId` VARCHAR(191) NOT NULL;
ALTER TABLE `Dossier` MODIFY `statutId` VARCHAR(191) NOT NULL;

-- 6) Anciennes colonnes enum + ancien index, plus utiles
ALTER TABLE `Dossier` DROP INDEX `Dossier_statut_idx`;
ALTER TABLE `Dossier` DROP COLUMN `type`;
ALTER TABLE `Dossier` DROP COLUMN `statut`;
ALTER TABLE `Dossier` DROP COLUMN `modePaiementAide`;

-- 7) Index + clés étrangères
CREATE INDEX `Dossier_statutId_idx` ON `Dossier`(`statutId`);
CREATE INDEX `Dossier_typeId_idx` ON `Dossier`(`typeId`);
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `DossierType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutId_fkey` FOREIGN KEY (`statutId`) REFERENCES `DossierStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_modePaiementAideId_fkey` FOREIGN KEY (`modePaiementAideId`) REFERENCES `ModePaiement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 8) Comptes équipe : statut actif/inactif
ALTER TABLE `User` ADD COLUMN `actif` BOOLEAN NOT NULL DEFAULT true;
