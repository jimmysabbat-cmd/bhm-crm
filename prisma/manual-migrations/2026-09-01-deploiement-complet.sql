-- ============================================================
-- BHM CRM — migration production complète (paramétrage + MAR/ANAH
-- + chantier/sous-traitants/régie + documents + délégataires CEE)
--
-- Sûre même si la table Dossier contient déjà des dossiers réels :
-- les nouvelles colonnes obligatoires (typeId, statutId) sont
-- d'abord ajoutées en NULL, puis remplies à partir des anciennes
-- valeurs, et ce n'est qu'ensuite qu'elles deviennent obligatoires
-- et que les anciennes colonnes sont supprimées. Si une étape
-- échoue, RIEN n'est perdu (les anciennes colonnes sont encore
-- là) : dans ce cas, s'arrêter et vérifier avant de continuer.
-- ============================================================

-- 1) Nouvelles tables de paramétrage (listes éditables)
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

CREATE TABLE `Mar` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Regie` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DelegataireCee` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `DossierDocument` (
    `id` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('DEVIS', 'AUDIT', 'PHOTO_VISITE', 'PHOTO_CHANTIER', 'AUTRE') NOT NULL,
    `nomFichier` VARCHAR(191) NOT NULL,
    `cheminFichier` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `tailleOctets` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `DossierDocument_dossierId_idx`(`dossierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) Peuplement des listes qui remplacent des anciens enums figés
--    (mêmes clés que les enums -> correspondance garantie à l'étape 5)
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

INSERT INTO `StatutAnah` (`id`, `key`, `label`, `ordre`) VALUES
  ('statut-anah-en-cours', 'EN_COURS', 'En cours', 0),
  ('statut-anah-depose-demandeur', 'DEPOSE_PAR_DEMANDEUR', 'Déposé par le demandeur', 1),
  ('statut-anah-en-cours-instruction', 'EN_COURS_INSTRUCTION', 'En cours d''instruction', 2),
  ('statut-anah-accepte', 'ACCEPTE', 'Accepté', 3),
  ('statut-anah-avance-deposee', 'DEMANDE_AVANCE_DEPOSEE', 'Demande avance déposée', 4),
  ('statut-anah-avance-payee', 'DEMANDE_AVANCE_PAYEE', 'Demande avance payée', 5),
  ('statut-anah-solde-deposee', 'DEMANDE_SOLDE_DEPOSEE', 'Demande solde déposée', 6),
  ('statut-anah-solde-payee', 'DEMANDE_SOLDE_PAYEE', 'Demande de solde payée', 7);

-- MAR, Régie et Délégataires CEE démarrent vides : à ajouter par l'admin
-- depuis /parametrage (ce sont des vraies listes, propres à BHM, sans
-- valeurs figées à migrer).

-- 3) Nouvelles colonnes sur les tables existantes (nullable pour l'instant
--    pour typeId/statutId, directement nullable pour le reste)
ALTER TABLE `User` ADD COLUMN `actif` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `SousTraitant` ADD COLUMN `actif` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `DossierPosteTravaux`
  ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `montantMaterielHTCts` INTEGER NULL,
  ADD COLUMN `montantMaterielTTCCts` INTEGER NULL,
  ADD COLUMN `montantPoseSousTraitanceCts` INTEGER NULL,
  ADD COLUMN `montantRegieCts` INTEGER NULL,
  ADD COLUMN `regieId` VARCHAR(191) NULL,
  ADD COLUMN `sousTraitantId` VARCHAR(191) NULL;

ALTER TABLE `Dossier`
  ADD COLUMN `typeId` VARCHAR(191) NULL,
  ADD COLUMN `statutId` VARCHAR(191) NULL,
  ADD COLUMN `modePaiementAideId` VARCHAR(191) NULL,
  ADD COLUMN `marId` VARCHAR(191) NULL,
  ADD COLUMN `delegataireCeeId` VARCHAR(191) NULL,
  ADD COLUMN `statutAnahId` VARCHAR(191) NULL,
  ADD COLUMN `dateDepotAnah` DATETIME(3) NULL,
  ADD COLUMN `dateOctroiAnah` DATETIME(3) NULL;

-- 4) Report des valeurs existantes vers les nouvelles clés
--    (no-op si la table Dossier est vide)
UPDATE `Dossier` d JOIN `DossierType` t ON t.`key` = d.`type` SET d.`typeId` = t.`id`;
UPDATE `Dossier` d JOIN `DossierStatus` s ON s.`key` = d.`statut` SET d.`statutId` = s.`id`;
UPDATE `Dossier` d JOIN `ModePaiement` m ON m.`key` = d.`modePaiementAide` SET d.`modePaiementAideId` = m.`id`;
-- (mar et delegataireCEE étaient du texte libre : pas de correspondance
-- automatique possible vers les nouvelles listes, elles seront à
-- réassigner manuellement depuis la fiche dossier si besoin)

-- 5) typeId/statutId deviennent obligatoires (échoue proprement si un
--    dossier n'a pas pu être rattaché à l'étape 4 — dans ce cas, RIEN
--    n'est perdu, s'arrêter ici et vérifier avant de continuer)
ALTER TABLE `Dossier` MODIFY `typeId` VARCHAR(191) NOT NULL;
ALTER TABLE `Dossier` MODIFY `statutId` VARCHAR(191) NOT NULL;

-- 6) Anciennes colonnes enum/texte + ancien index, plus utiles
ALTER TABLE `Dossier` DROP INDEX `Dossier_statut_idx`;
ALTER TABLE `Dossier` DROP COLUMN `type`;
ALTER TABLE `Dossier` DROP COLUMN `statut`;
ALTER TABLE `Dossier` DROP COLUMN `modePaiementAide`;
ALTER TABLE `Dossier` DROP COLUMN `mar`;
ALTER TABLE `Dossier` DROP COLUMN `delegataireCEE`;

-- 7) Index + clés étrangères
CREATE INDEX `Dossier_statutId_idx` ON `Dossier`(`statutId`);
CREATE INDEX `Dossier_typeId_idx` ON `Dossier`(`typeId`);

ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `DossierType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutId_fkey` FOREIGN KEY (`statutId`) REFERENCES `DossierStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_modePaiementAideId_fkey` FOREIGN KEY (`modePaiementAideId`) REFERENCES `ModePaiement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_marId_fkey` FOREIGN KEY (`marId`) REFERENCES `Mar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_delegataireCeeId_fkey` FOREIGN KEY (`delegataireCeeId`) REFERENCES `DelegataireCee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_statutAnahId_fkey` FOREIGN KEY (`statutAnahId`) REFERENCES `StatutAnah`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_sousTraitantId_fkey` FOREIGN KEY (`sousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DossierPosteTravaux` ADD CONSTRAINT `DossierPosteTravaux_regieId_fkey` FOREIGN KEY (`regieId`) REFERENCES `Regie`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DossierDocument` ADD CONSTRAINT `DossierDocument_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
