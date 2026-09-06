-- AlterTable
-- P12 : un PLATFORM SUPER ADMIN n'a besoin d'aucun tenant d'ancrage.
-- organisationId devient nullable pour ce cas précis (voir schema.prisma /
-- requireUserContext() dans src/lib/authz.ts). La contrainte FK existante
-- (User_organisationId_fkey, ON DELETE RESTRICT) n'a pas besoin d'être
-- modifiée : une valeur NULL ne pose jamais de contrainte référentielle.
ALTER TABLE `User` MODIFY `organisationId` VARCHAR(191) NULL;
