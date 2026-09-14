import { prisma } from "@/lib/prisma";

// ============================================================
// P16 - numérotation séquentielle des factures DONNEUR_ORDRE.
//
// Obligation légale française : une facture émise par l'entreprise doit
// porter un numéro séquentiel sans trou, par année. Une facture SOUS_TRAITANT
// n'est JAMAIS numérotée ici - c'est un document reçu, son "numero" est la
// référence propre du sous-traitant (texte libre saisi au dépôt, cf.
// commentaire du champ Facture.numero dans le schéma).
//
// L'incrémentation se fait dans une transaction Prisma dédiée (jamais une
// lecture puis une écriture séparées) pour garantir qu'aucun numéro n'est
// jamais attribué deux fois, même en cas de générations concurrentes.
// ============================================================

export async function genererNumeroFactureDonneurOrdre(organisationId: string, annee = new Date().getFullYear()): Promise<string> {
  const dernierNumero = await prisma.$transaction(async (tx) => {
    const compteur = await tx.compteurFacture.findUnique({
      where: { organisationId_type_annee: { organisationId, type: "DONNEUR_ORDRE", annee } },
    });
    if (compteur) {
      const updated = await tx.compteurFacture.update({
        where: { id: compteur.id },
        data: { dernierNumero: { increment: 1 } },
      });
      return updated.dernierNumero;
    }
    const created = await tx.compteurFacture.create({
      data: { organisationId, type: "DONNEUR_ORDRE", annee, dernierNumero: 1 },
    });
    return created.dernierNumero;
  });

  return `FDO-${annee}-${String(dernierNumero).padStart(4, "0")}`;
}
