import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { getDocumentStorageProvider } from "@/lib/storage";
import { formatCents } from "@/lib/money";

// ============================================================
// P16 - génération du PDF de facture.
//
// Uniquement pour les factures DONNEUR_ORDRE (document émis par nos soins) :
// une facture SOUS_TRAITANT est un justificatif REÇU, son PDF est le fichier
// déposé par le sous-traitant lui-même (cf. deposerFactureSousTraitantAction
// dans actions.ts) - jamais régénéré ici.
//
// Le PDF est stocké via le DocumentStorageProvider actif (P12), comme
// n'importe quelle autre pièce du dossier - aucun second circuit de fichiers.
// ============================================================

function renderInvoicePdfBuffer(facture: {
  numero: string;
  dateEmission: Date;
  dateEcheance: Date | null;
  montantHTCts: number;
  montantTVACts: number;
  montantTTCCts: number;
  organisation: { nom: string; raisonSociale: string | null; siret: string | null; tva: string | null; adresse: string | null; email: string | null; telephone: string | null };
  dossier: { reference: string; client: { prenom: string; nom: string; adresse: string | null; ville: string | null } };
  donneurOrdre: { nom: string; contactEmail: string | null } | null;
  lignes: { designation: string; quantite: number; prixUnitaireHTCts: number; tauxTVA: number; montantHTCts: number }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const emetteur = facture.organisation;

    doc.fontSize(18).text(emetteur.raisonSociale ?? emetteur.nom, 50, 50);
    doc.fontSize(9).fillColor("#555");
    if (emetteur.adresse) doc.text(emetteur.adresse);
    const legalLine = [emetteur.siret ? `SIRET ${emetteur.siret}` : null, emetteur.tva ? `TVA ${emetteur.tva}` : null].filter(Boolean).join(" — ");
    if (legalLine) doc.text(legalLine);
    if (emetteur.email) doc.text(emetteur.email);
    if (emetteur.telephone) doc.text(emetteur.telephone);
    doc.fillColor("#000");

    doc.fontSize(22).text("FACTURE", 50, 140);
    doc.fontSize(10).text(`N° ${facture.numero}`, 50, 170);
    doc.text(`Date d'émission : ${facture.dateEmission.toLocaleDateString("fr-FR")}`);
    if (facture.dateEcheance) doc.text(`Échéance : ${facture.dateEcheance.toLocaleDateString("fr-FR")}`);
    doc.text(`Dossier : ${facture.dossier.reference}`);

    doc.fontSize(11).text("Facturé à :", 320, 170);
    doc.fontSize(10);
    if (facture.donneurOrdre) {
      doc.text(facture.donneurOrdre.nom, 320, 188);
      if (facture.donneurOrdre.contactEmail) doc.text(facture.donneurOrdre.contactEmail, 320);
    }
    doc.text(`Réf. client : ${facture.dossier.client.prenom} ${facture.dossier.client.nom}`, 320);
    if (facture.dossier.client.adresse) doc.text(facture.dossier.client.adresse, 320);
    if (facture.dossier.client.ville) doc.text(facture.dossier.client.ville, 320);

    let y = 260;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 8;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Désignation", 50, y, { width: 250 });
    doc.text("Qté", 300, y, { width: 40, align: "right" });
    doc.text("PU HT", 345, y, { width: 70, align: "right" });
    doc.text("TVA", 420, y, { width: 40, align: "right" });
    doc.text("Total HT", 465, y, { width: 80, align: "right" });
    doc.font("Helvetica");
    y += 16;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 6;

    for (const ligne of facture.lignes) {
      doc.text(ligne.designation, 50, y, { width: 250 });
      doc.text(String(ligne.quantite), 300, y, { width: 40, align: "right" });
      doc.text(formatCents(ligne.prixUnitaireHTCts), 345, y, { width: 70, align: "right" });
      doc.text(`${(ligne.tauxTVA * 100).toFixed(1)}%`, 420, y, { width: 40, align: "right" });
      doc.text(formatCents(ligne.montantHTCts), 465, y, { width: 80, align: "right" });
      y += 18;
    }

    y += 8;
    doc.moveTo(320, y).lineTo(545, y).stroke();
    y += 8;
    doc.text("Total HT", 320, y, { width: 145, align: "right" });
    doc.text(formatCents(facture.montantHTCts), 465, y, { width: 80, align: "right" });
    y += 16;
    doc.text("TVA", 320, y, { width: 145, align: "right" });
    doc.text(formatCents(facture.montantTVACts), 465, y, { width: 80, align: "right" });
    y += 16;
    doc.font("Helvetica-Bold");
    doc.text("Total TTC", 320, y, { width: 145, align: "right" });
    doc.text(formatCents(facture.montantTTCCts), 465, y, { width: 80, align: "right" });
    doc.font("Helvetica");

    doc.end();
  });
}

export async function genererEtEnregistrerPdfFactureDonneurOrdre(factureId: string): Promise<string> {
  const facture = await prisma.facture.findUniqueOrThrow({
    where: { id: factureId },
    include: {
      organisation: true,
      dossier: { include: { client: true } },
      donneurOrdre: true,
      lignes: { orderBy: { ordre: "asc" } },
    },
  });

  const buffer = await renderInvoicePdfBuffer(facture);
  const pseudoFile = {
    name: `${facture.numero}.pdf`,
    type: "application/pdf",
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  };
  const stored = await getDocumentStorageProvider().save(facture.dossierId, pseudoFile);
  await prisma.facture.update({ where: { id: facture.id }, data: { fichierPdfPath: stored.key } });
  return stored.key;
}
