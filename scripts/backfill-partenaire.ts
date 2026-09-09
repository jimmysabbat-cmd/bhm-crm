import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// ============================================================
// Backfill SousTraitant/DelegataireCee -> Partenaire (P13, audit SaaS
// section E) - TRANSITOIRE et IDEMPOTENT : ne touche JAMAIS
// User.sousTraitantId/delegataireCeeId (colonnes historiques conservées
// intactes et pleinement fonctionnelles), crée seulement le pendant
// générique Partenaire+PartenaireRole pour chaque ligne qui n'en a pas
// encore. Rejouable sans effet : toute ligne déjà migrée (partenaireId
// renseigné) est ignorée.
//
// NE JAMAIS EXÉCUTER CE SCRIPT CONTRE LA BASE DE PRODUCTION (crmp12) SANS
// VALIDATION EXPLICITE - il est prévu ici uniquement pour être testé sur
// des données de développement (section J de l'audit SaaS : "prépare le
// SQL/script et teste sur données de développement", jamais lancé
// automatiquement contre la prod).
// ============================================================

async function main() {
  const dryRun = process.env.BACKFILL_DRY_RUN !== "false";
  console.log(dryRun ? "MODE DRY-RUN (aucune écriture) - BACKFILL_DRY_RUN=false pour appliquer réellement." : "MODE APPLICATION RÉELLE.");

  const sousTraitants = await prisma.sousTraitant.findMany({
    where: { partenaireId: null, organisationId: { not: null } },
    select: { id: true, organisationId: true, nom: true, email: true, telephone: true },
  });
  const delegataires = await prisma.delegataireCee.findMany({
    where: { partenaireId: null, organisationId: { not: null } },
    select: { id: true, organisationId: true, nom: true },
  });

  console.log(`SousTraitant à migrer : ${sousTraitants.length}`);
  console.log(`DelegataireCee à migrer : ${delegataires.length}`);

  let created = 0;
  for (const st of sousTraitants) {
    if (!st.organisationId) continue;
    if (dryRun) {
      console.log(`  [dry-run] SousTraitant "${st.nom}" (${st.id}) -> nouveau Partenaire + rôle SOUS_TRAITANT`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const partenaire = await tx.partenaire.create({
        data: { organisationId: st.organisationId!, nom: st.nom, email: st.email, telephone: st.telephone },
      });
      await tx.partenaireRole.create({ data: { partenaireId: partenaire.id, role: "SOUS_TRAITANT" } });
      await tx.sousTraitant.update({ where: { id: st.id }, data: { partenaireId: partenaire.id } });
    });
    created++;
  }

  for (const del of delegataires) {
    if (!del.organisationId) continue;
    if (dryRun) {
      console.log(`  [dry-run] DelegataireCee "${del.nom}" (${del.id}) -> nouveau Partenaire + rôle DELEGATAIRE_CEE`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const partenaire = await tx.partenaire.create({ data: { organisationId: del.organisationId!, nom: del.nom } });
      await tx.partenaireRole.create({ data: { partenaireId: partenaire.id, role: "DELEGATAIRE_CEE" } });
      await tx.delegataireCee.update({ where: { id: del.id }, data: { partenaireId: partenaire.id } });
    });
    created++;
  }

  console.log(dryRun ? `Dry-run terminé (${sousTraitants.length + delegataires.length} lignes seraient migrées).` : `Backfill terminé : ${created} Partenaire créés.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
