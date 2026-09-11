-- AlterTable
ALTER TABLE `Client` ADD COLUMN `anneeReferenceRevenu` INTEGER NULL,
    ADD COLUMN `nombrePersonnesFoyer` INTEGER NULL,
    ADD COLUMN `revenuFiscalReference` INTEGER NULL,
    ADD COLUMN `typeOccupant` ENUM('PROPRIETAIRE', 'LOCATAIRE', 'BAILLEUR') NULL;

-- AlterTable
ALTER TABLE `Question` ADD COLUMN `categorieImpact` ENUM('BLOQUANT_DECISION', 'ELIGIBILITE', 'CONFIRMATION_OPPORTUNITE', 'PROGRAMME_AIDE', 'SCENARIO', 'TECHNIQUE_RDV', 'COMMERCIAL') NULL,
    ADD COLUMN `metierConcerne` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NULL,
    ADD COLUMN `poidsCommercial` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ReponseQuestionnaire` ADD COLUMN `opportunitesSnapshot` JSON NULL,
    ADD COLUMN `rdvCreeId` VARCHAR(191) NULL,
    ADD COLUMN `realiseParId` VARCHAR(191) NULL,
    ADD COLUMN `statut` ENUM('EN_COURS', 'TERMINEE', 'ABANDONNEE') NOT NULL DEFAULT 'EN_COURS',
    ADD COLUMN `termineeAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `FicheMetier` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `typeTravaux` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `categorie` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `ordre` INTEGER NOT NULL DEFAULT 0,
    `conditionsActivation` JSON NOT NULL,
    `donneesNecessairesEligibilite` JSON NOT NULL,
    `argumentaireId` VARCHAR(191) NULL,
    `typeRdvRecommande` ENUM('TELEPHONIQUE', 'VISITE', 'AUTRE') NULL,
    `controlesTechniques` JSON NOT NULL,
    `prochaineAction` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FicheMetier_organisationId_idx`(`organisationId`),
    INDEX `FicheMetier_typeTravaux_idx`(`typeTravaux`),
    UNIQUE INDEX `FicheMetier_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FicheMetierProgramme` (
    `id` VARCHAR(191) NOT NULL,
    `ficheMetierId` VARCHAR(191) NOT NULL,
    `programmeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FicheMetierProgramme_programmeId_idx`(`programmeId`),
    UNIQUE INDEX `FicheMetierProgramme_ficheMetierId_programmeId_key`(`ficheMetierId`, `programmeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FicheMetierRegleReglementaire` (
    `id` VARCHAR(191) NOT NULL,
    `ficheMetierId` VARCHAR(191) NOT NULL,
    `regleReglementaireId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FicheMetierRegleReglementaire_regleReglementaireId_idx`(`regleReglementaireId`),
    UNIQUE INDEX `FicheMetierRegleReglementaire_ficheMetierId_regleReglementai_key`(`ficheMetierId`, `regleReglementaireId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArgumentaireMetier` (
    `id` VARCHAR(191) NOT NULL,
    `organisationId` VARCHAR(191) NOT NULL,
    `typeTravaux` ENUM('RACCORDEMENT_RESEAU_CHALEUR', 'CHAUFFE_EAU_THERMODYNAMIQUE', 'PAC_AIR_EAU', 'PAC_AIR_AIR', 'PAC_GEOTHERMIQUE_SOLAROTHERMIQUE', 'CHAUFFE_EAU_SOLAIRE_INDIVIDUEL', 'CHAUFFAGE_SOLAIRE_COMBINE', 'PVT_EAU', 'POELE_BUCHES', 'POELE_GRANULES', 'CHAUDIERE_BOIS_MANUELLE', 'CHAUDIERE_BOIS_AUTOMATIQUE', 'FOYER_FERME_INSERT', 'ITE', 'ITI', 'COMBLES', 'RAMPANTS', 'TOITURE_TERRASSE', 'PAROIS_VITREES', 'AUDIT_ENERGETIQUE', 'DEPOSE_CUVE_FIOUL', 'VMC', 'BALLON_THERMODYNAMIQUE', 'AUTRE') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `libelle` VARCHAR(191) NOT NULL,
    `pourquoi` TEXT NULL,
    `benefices` TEXT NULL,
    `aConfirmer` TEXT NULL,
    `prochaineEtape` TEXT NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ArgumentaireMetier_organisationId_idx`(`organisationId`),
    UNIQUE INDEX `ArgumentaireMetier_organisationId_code_key`(`organisationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ReponseQuestionnaire_realiseParId_idx` ON `ReponseQuestionnaire`(`realiseParId`);

-- CreateIndex
CREATE INDEX `ReponseQuestionnaire_rdvCreeId_idx` ON `ReponseQuestionnaire`(`rdvCreeId`);

-- AddForeignKey
ALTER TABLE `ReponseQuestionnaire` ADD CONSTRAINT `ReponseQuestionnaire_realiseParId_fkey` FOREIGN KEY (`realiseParId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReponseQuestionnaire` ADD CONSTRAINT `ReponseQuestionnaire_rdvCreeId_fkey` FOREIGN KEY (`rdvCreeId`) REFERENCES `Rdv`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetier` ADD CONSTRAINT `FicheMetier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetier` ADD CONSTRAINT `FicheMetier_argumentaireId_fkey` FOREIGN KEY (`argumentaireId`) REFERENCES `ArgumentaireMetier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetierProgramme` ADD CONSTRAINT `FicheMetierProgramme_ficheMetierId_fkey` FOREIGN KEY (`ficheMetierId`) REFERENCES `FicheMetier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetierProgramme` ADD CONSTRAINT `FicheMetierProgramme_programmeId_fkey` FOREIGN KEY (`programmeId`) REFERENCES `Programme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetierRegleReglementaire` ADD CONSTRAINT `FicheMetierRegleReglementaire_ficheMetierId_fkey` FOREIGN KEY (`ficheMetierId`) REFERENCES `FicheMetier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FicheMetierRegleReglementaire` ADD CONSTRAINT `FicheMetierRegleReglementaire_regleReglementaireId_fkey` FOREIGN KEY (`regleReglementaireId`) REFERENCES `RegleReglementaire`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArgumentaireMetier` ADD CONSTRAINT `ArgumentaireMetier_organisationId_fkey` FOREIGN KEY (`organisationId`) REFERENCES `Organisation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
