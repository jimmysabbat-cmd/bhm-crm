-- AlterTable
ALTER TABLE `TransmissionPackage` ADD COLUMN `dateDebutSouhaitee` DATETIME(3) NULL,
    ADD COLUMN `dateFinSouhaitee` DATETIME(3) NULL,
    ADD COLUMN `posteTravauxId` VARCHAR(191) NULL,
    ADD COLUMN `prixConvenuCts` INTEGER NULL,
    ADD COLUMN `refusalReason` VARCHAR(191) NULL,
    ADD COLUMN `respondedAt` DATETIME(3) NULL,
    ADD COLUMN `respondedById` VARCHAR(191) NULL,
    MODIFY `status` ENUM('BROUILLON', 'PRET', 'TRANSMIS', 'ANNULE', 'ENVOYEE', 'ACCEPTEE', 'REFUSEE', 'PLANIFIEE', 'EN_COURS', 'TERMINEE') NOT NULL DEFAULT 'BROUILLON';

-- CreateIndex
CREATE INDEX `TransmissionPackage_posteTravauxId_idx` ON `TransmissionPackage`(`posteTravauxId`);

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_posteTravauxId_fkey` FOREIGN KEY (`posteTravauxId`) REFERENCES `DossierPosteTravaux`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransmissionPackage` ADD CONSTRAINT `TransmissionPackage_respondedById_fkey` FOREIGN KEY (`respondedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

