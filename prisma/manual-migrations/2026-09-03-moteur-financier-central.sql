-- ============================================================
-- BHM CRM — moteur financier central (P6).
--
-- Entièrement additif : nouvelles valeurs d'enum (CategorieMouvementFinancier,
-- StatutMouvementFinancier) + deux nouveaux enums (PartiePrenante,
-- ConditionExigibilite) + trois nouvelles colonnes nullable sur
-- MouvementFinancier (payeurType, beneficiaireType, exigibleQuand).
-- Aucune colonne existante modifiée ni supprimée, aucune donnée existante
-- affectée : les mouvements déjà en base héritent de payeurType/
-- beneficiaireType/exigibleQuand = NULL, exactement comme prévu par le
-- schéma (colonnes nullable). Pas de nouvelle table : Créances, Dettes et
-- Commissions sont des vues dérivées de MouvementFinancier, calculées par
-- src/lib/financial-engine.ts (cf. commentaires dans ce fichier pour le
-- raisonnement détaillé) - rien à migrer pour elles.
-- ============================================================

-- 1) Nouvelles valeurs sur les enums existants (MySQL : ALTER COLUMN avec la
--    liste complète des valeurs, anciennes + nouvelles - jamais de valeur
--    supprimée ni renommée).
ALTER TABLE `MouvementFinancier`
  MODIFY COLUMN `categorie` ENUM(
    'ENCAISSEMENT_CLIENT','ENCAISSEMENT_ANAH','ENCAISSEMENT_MPR','ENCAISSEMENT_CEE',
    'PAIEMENT_SOUS_TRAITANT','PAIEMENT_FOURNISSEUR',
    'COMMISSION_COMMERCIALE','COMMISSION_REGIE','COMMISSION_APPORTEUR',
    'AUTRE_ENTREE','AUTRE_SORTIE',
    'CLIENT_ACOMPTE','CLIENT_SOLDE','REMBOURSEMENT_AVANCE_CLIENT','FINANCEMENT_PARTENAIRE',
    'POSE_INTERNE','PAIEMENT_MAR','PAIEMENT_AUDIT','PAIEMENT_CONTROLE',
    'TRANSPORT','LOCATION_MATERIEL','ECHAFAUDAGE','FRAIS_FINANCEMENT'
  ) NOT NULL;

ALTER TABLE `MouvementFinancier`
  MODIFY COLUMN `statut` ENUM(
    'PREVU','A_RECEVOIR','A_PAYER','PARTIEL','RECU','PAYE','ANNULE','EN_RETARD',
    'LITIGE','BLOQUE'
  ) NOT NULL DEFAULT 'PREVU';

-- 2) Nouvelles colonnes nullable sur MouvementFinancier
ALTER TABLE `MouvementFinancier`
  ADD COLUMN `payeurType` ENUM(
    'CLIENT','ENTREPRISE','ANAH','CEE','FINANCEUR','FOURNISSEUR','SOUS_TRAITANT',
    'REGIE','COMMERCIAL','APPORTEUR','MAR','AUTRE'
  ) NULL,
  ADD COLUMN `beneficiaireType` ENUM(
    'CLIENT','ENTREPRISE','ANAH','CEE','FINANCEUR','FOURNISSEUR','SOUS_TRAITANT',
    'REGIE','COMMERCIAL','APPORTEUR','MAR','AUTRE'
  ) NULL,
  ADD COLUMN `exigibleQuand` ENUM(
    'A_LA_SIGNATURE','A_L_ACCEPTATION','AU_DEMARRAGE_TRAVAUX','A_LA_FIN_TRAVAUX',
    'A_L_ENCAISSEMENT_CLIENT','A_L_ENCAISSEMENT_ANAH','A_L_ENCAISSEMENT_CEE','MANUEL'
  ) NULL;

-- ============================================================
-- Vérifications post-migration recommandées (production) :
--   SELECT COUNT(*) FROM `MouvementFinancier`;                              -- inchangé
--   SELECT COUNT(*) FROM `MouvementFinancier` WHERE `payeurType` IS NOT NULL; -- = 0 juste après la migration
--   SHOW COLUMNS FROM `MouvementFinancier` LIKE 'payeurType';
--   SHOW COLUMNS FROM `MouvementFinancier` LIKE 'beneficiaireType';
--   SHOW COLUMNS FROM `MouvementFinancier` LIKE 'exigibleQuand';
-- ============================================================
