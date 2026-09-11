-- P14.1 : corrige le bug de confiance (la fiabilité LOW/MEDIUM/HIGH
-- retournée par un connecteur était calculée puis jetée avant persistance).
-- Additif uniquement : une seule nouvelle colonne nullable sur
-- ChampProvenance, aucune donnée existante modifiée ou supprimée.

ALTER TABLE `ChampProvenance`
    ADD COLUMN `confianceProposee` ENUM('FAIBLE', 'MOYENNE', 'ELEVEE') NULL;
