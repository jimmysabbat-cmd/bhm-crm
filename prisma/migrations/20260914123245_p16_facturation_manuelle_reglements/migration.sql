-- AlterTable
ALTER TABLE `Facture` MODIFY COLUMN `type` ENUM('DONNEUR_ORDRE', 'SOUS_TRAITANT', 'CLIENT') NOT NULL;
ALTER TABLE `Facture` MODIFY COLUMN `statut` ENUM('BROUILLON', 'A_TRANSMETTRE', 'TRANSMISE', 'RECUE', 'A_CONTROLER', 'VALIDEE', 'A_PAYER', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'EN_RETARD', 'REFUSEE', 'ANNULEE', 'LITIGE', 'EMISE') NOT NULL DEFAULT 'BROUILLON';

-- AlterTable
ALTER TABLE `CompteurFacture` MODIFY COLUMN `type` ENUM('DONNEUR_ORDRE', 'SOUS_TRAITANT', 'CLIENT') NOT NULL;

-- CreateTable
CREATE TABLE `ReglementFacture` (
    `id` VARCHAR(191) NOT NULL,
    `factureId` VARCHAR(191) NOT NULL,
    `montantCts` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `mode` ENUM('VIREMENT', 'CHEQUE', 'CB', 'ESPECES', 'PRELEVEMENT', 'AIDE', 'MANDATAIRE', 'AUTRE') NOT NULL,
    `reference` VARCHAR(191) NULL,
    `commentaire` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReglementFacture_factureId_idx`(`factureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FactureTransmission` (
    `id` VARCHAR(191) NOT NULL,
    `factureId` VARCHAR(191) NOT NULL,
    `destinataire` VARCHAR(191) NOT NULL,
    `transmisAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `transmisById` VARCHAR(191) NULL,

    INDEX `FactureTransmission_factureId_idx`(`factureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReglementFacture` ADD CONSTRAINT `ReglementFacture_factureId_fkey` FOREIGN KEY (`factureId`) REFERENCES `Facture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReglementFacture` ADD CONSTRAINT `ReglementFacture_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `FactureTransmission` ADD CONSTRAINT `FactureTransmission_factureId_fkey` FOREIGN KEY (`factureId`) REFERENCES `Facture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FactureTransmission` ADD CONSTRAINT `FactureTransmission_transmisById_fkey` FOREIGN KEY (`transmisById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
