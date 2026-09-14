-- P16 - Planning central, portail donneur d'ordre, facturation DO/ST.
-- Additif uniquement : aucune colonne/table existante n'est supprimée ou
-- renommée. TransmissionPackage/MouvementFinancier/DossierPosteTravaux
-- restent les seules sources de vérité déjà en place (P6/P10/P15) -
-- Facture s'y raccorde sans jamais dupliquer une donnée déjà comptée
-- (cf. commentaires de section dans schema.prisma).

-- ============================================================
-- A. Enums étendus (valeurs ajoutées uniquement, ordre des valeurs
--    existantes conservé pour ne perturber aucune donnée déjà stockée)
-- ============================================================

ALTER TABLE `User` MODIFY COLUMN `role` ENUM('ADMIN', 'COMMERCIAL', 'COMPTA', 'ADMINISTRATIF', 'REGIE', 'SOUS_TRAITANT', 'COMPTABILITE', 'TECHNIQUE', 'TELEPROSPECTEUR', 'DELEGATAIRE_CEE', 'DONNEUR_ORDRE') NOT NULL DEFAULT 'COMMERCIAL';

ALTER TABLE `TransmissionPackage` MODIFY COLUMN `destinationType` ENUM('ANAH', 'MAR', 'CEE', 'DELEGATAIRE_CEE', 'CONTROLEUR', 'SOUS_TRAITANT', 'FOURNISSEUR', 'CLIENT', 'COMPTABILITE', 'AUTRE', 'REGIE') NOT NULL;

ALTER TABLE `MouvementFinancier`
    MODIFY COLUMN `categorie` ENUM('ENCAISSEMENT_CLIENT', 'ENCAISSEMENT_ANAH', 'ENCAISSEMENT_MPR', 'ENCAISSEMENT_CEE', 'PAIEMENT_SOUS_TRAITANT', 'PAIEMENT_FOURNISSEUR', 'COMMISSION_COMMERCIALE', 'COMMISSION_REGIE', 'COMMISSION_APPORTEUR', 'AUTRE_ENTREE', 'AUTRE_SORTIE', 'CLIENT_ACOMPTE', 'CLIENT_SOLDE', 'REMBOURSEMENT_AVANCE_CLIENT', 'FINANCEMENT_PARTENAIRE', 'POSE_INTERNE', 'PAIEMENT_MAR', 'PAIEMENT_AUDIT', 'PAIEMENT_CONTROLE', 'TRANSPORT', 'LOCATION_MATERIEL', 'ECHAFAUDAGE', 'FRAIS_FINANCEMENT', 'ENCAISSEMENT_DONNEUR_ORDRE') NOT NULL,
    MODIFY COLUMN `payeurType` ENUM('CLIENT', 'ENTREPRISE', 'ANAH', 'CEE', 'FINANCEUR', 'FOURNISSEUR', 'SOUS_TRAITANT', 'REGIE', 'COMMERCIAL', 'APPORTEUR', 'MAR', 'AUTRE', 'DONNEUR_ORDRE') NULL,
    MODIFY COLUMN `beneficiaireType` ENUM('CLIENT', 'ENTREPRISE', 'ANAH', 'CEE', 'FINANCEUR', 'FOURNISSEUR', 'SOUS_TRAITANT', 'REGIE', 'COMMERCIAL', 'APPORTEUR', 'MAR', 'AUTRE', 'DONNEUR_ORDRE') NULL;

-- ============================================================
-- B. Nouvelles colonnes sur tables existantes (toutes nullables - aucune
--    ligne existante n'est affectée)
-- ============================================================

ALTER TABLE `User` ADD COLUMN `donneurOrdreId` VARCHAR(191) NULL;
ALTER TABLE `Dossier` ADD COLUMN `donneurOrdreId` VARCHAR(191) NULL;
ALTER TABLE `TransmissionPackage` ADD COLUMN `destinationRegieId` VARCHAR(191) NULL;

CREATE INDEX `User_donneurOrdreId_idx` ON `User`(`donneurOrdreId`);
CREATE INDEX `Dossier_donneurOrdreId_idx` ON `Dossier`(`donneurOrdreId`);
CREATE INDEX `TransmissionPackage_destinationRegieId_idx` ON `TransmissionPackage`(`destinationRegieId`);

-- ============================================================
-- C. Donneur d'ordre (référentiel, même principe que SousTraitant/Regie)
-- ============================================================

CREATE TABLE `DonneurOrdre` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NULL,
    `nom` VARCHAR(191) NOT NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactTelephone` VARCHAR(191) NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DonneurOrdre_organisationId_idx`(`organisationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- D. Facturation (Facture / FactureLigne / CompteurFacture) - jamais de
--    duplication du CA/coûts déjà comptés par MouvementFinancier/postes
--    (cf. schema.prisma pour le détail des garanties).
-- ============================================================

CREATE TABLE `Facture` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `dossierId` VARCHAR(191) NOT NULL,
    `type` ENUM('DONNEUR_ORDRE', 'SOUS_TRAITANT') NOT NULL,
    `numero` VARCHAR(191) NOT NULL,
    `donneurOrdreId` VARCHAR(191) NULL,
    `sousTraitantId` VARCHAR(191) NULL,
    `montantHTCts` INTEGER NOT NULL,
    `tauxTVA` DOUBLE NOT NULL,
    `montantTVACts` INTEGER NOT NULL,
    `montantTTCCts` INTEGER NOT NULL,
    `dateEmission` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dateEcheance` DATETIME(3) NULL,
    `statut` ENUM('BROUILLON', 'EMISE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'EN_RETARD', 'ANNULEE', 'LITIGE') NOT NULL DEFAULT 'BROUILLON',
    `fichierPdfPath` VARCHAR(191) NULL,
    `validatedById` VARCHAR(191) NULL,
    `validatedAt` DATETIME(3) NULL,
    `mouvementFinancierId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Facture_mouvementFinancierId_key`(`mouvementFinancierId`),
    UNIQUE INDEX `Facture_organisationId_type_numero_key`(`organisationId`, `type`, `numero`),
    INDEX `Facture_organisationId_idx`(`organisationId`),
    INDEX `Facture_dossierId_idx`(`dossierId`),
    INDEX `Facture_donneurOrdreId_idx`(`donneurOrdreId`),
    INDEX `Facture_sousTraitantId_idx`(`sousTraitantId`),
    INDEX `Facture_statut_idx`(`statut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FactureLigne` (
    `id` VARCHAR(191) NOT NULL,
    `factureId` VARCHAR(191) NOT NULL,
    `posteTravauxId` VARCHAR(191) NULL,
    `designation` VARCHAR(191) NOT NULL,
    `quantite` DOUBLE NOT NULL DEFAULT 1,
    `prixUnitaireHTCts` INTEGER NOT NULL,
    `tauxTVA` DOUBLE NOT NULL,
    `montantHTCts` INTEGER NOT NULL,
    `ordre` INTEGER NOT NULL DEFAULT 0,

    INDEX `FactureLigne_factureId_idx`(`factureId`),
    INDEX `FactureLigne_posteTravauxId_idx`(`posteTravauxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CompteurFacture` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `type` ENUM('DONNEUR_ORDRE', 'SOUS_TRAITANT') NOT NULL,
    `annee` INTEGER NOT NULL,
    `dernierNumero` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `CompteurFacture_organisationId_type_annee_key`(`organisationId`, `type`, `annee`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- E. Foreign Keys
-- ============================================================

ALTER TABLE `User` ADD CONSTRAINT `User_donneurOrdreId_fkey` FOREIGN KEY (`donneurOrdreId`) REFERENCES `DonneurOrdre`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_donneurOrdreId_fkey` FOREIGN KEY (`donneurOrdreId`) REFERENCES `DonneurOrdre`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_destinationRegieId_fkey` FOREIGN KEY (`destinationRegieId`) REFERENCES `Regie`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DonneurOrdre` ADD CONSTRAINT `DonneurOrdre_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Facture` ADD CONSTRAINT `Facture_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_dossierId_fkey` FOREIGN KEY (`dossierId`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_donneurOrdreId_fkey` FOREIGN KEY (`donneurOrdreId`) REFERENCES `DonneurOrdre`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_sousTraitantId_fkey` FOREIGN KEY (`sousTraitantId`) REFERENCES `SousTraitant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_mouvementFinancierId_fkey` FOREIGN KEY (`mouvementFinancierId`) REFERENCES `MouvementFinancier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Facture` ADD CONSTRAINT `Facture_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `FactureLigne` ADD CONSTRAINT `FactureLigne_factureId_fkey` FOREIGN KEY (`factureId`) REFERENCES `Facture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FactureLigne` ADD CONSTRAINT `FactureLigne_posteTravauxId_fkey` FOREIGN KEY (`posteTravauxId`) REFERENCES `DossierPosteTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CompteurFacture` ADD CONSTRAINT `CompteurFacture_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
