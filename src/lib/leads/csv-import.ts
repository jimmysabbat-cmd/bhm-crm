import { normalizePhoneNumber } from "@/lib/phone";

// ============================================================
// Import CSV de leads (P9, section 24) - fonctions PURES (aucun accès
// Prisma ici) : parseLeadsCsv() produit un aperçu avec erreurs/doublons
// internes au fichier, jamais une ligne invalide importée silencieusement.
// La détection de doublons contre la base existante (Lead/Client) se fait
// séparément côté Server Action (réutilise findPotentialDuplicates), qui a
// seule la connaissance de l'organisation courante.
// ============================================================

export type CsvLeadRow = {
  index: number;
  nom: string;
  prenom: string;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  source: string | null;
  commentaire: string | null;
  errors: string[];
  /** index d'une autre ligne du MÊME fichier avec le même téléphone/email normalisé. */
  duplicateOfIndex: number | null;
};

const COLUMN_ALIASES: Record<string, keyof Omit<CsvLeadRow, "index" | "errors" | "duplicateOfIndex">> = {
  nom: "nom",
  prenom: "prenom",
  "prénom": "prenom",
  telephone: "telephone",
  "téléphone": "telephone",
  tel: "telephone",
  email: "email",
  "e-mail": "email",
  adresse: "adresse",
  cp: "codePostal",
  codepostal: "codePostal",
  "code postal": "codePostal",
  ville: "ville",
  source: "source",
  commentaire: "commentaire",
  notes: "commentaire",
};

function detectDelimiter(headerLine: string): "," | ";" {
  return (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

export function parseLeadsCsv(text: string): { rows: CsvLeadRow[]; unknownColumns: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], unknownColumns: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());
  const columnMap: (keyof CsvLeadRow | null)[] = [];
  const unknownColumns: string[] = [];
  for (const h of headerCells) {
    const mapped = COLUMN_ALIASES[h];
    if (mapped) columnMap.push(mapped);
    else {
      columnMap.push(null);
      if (h) unknownColumns.push(h);
    }
  }

  const rows: CsvLeadRow[] = [];
  const seenTelephone = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li], delimiter);
    const row: CsvLeadRow = {
      index: li,
      nom: "",
      prenom: "",
      telephone: null,
      email: null,
      adresse: null,
      codePostal: null,
      ville: null,
      source: null,
      commentaire: null,
      errors: [],
      duplicateOfIndex: null,
    };
    columnMap.forEach((field, ci) => {
      if (!field) return;
      const value = cells[ci]?.trim() || null;
      if (field === "nom") row.nom = value ?? "";
      else if (field === "prenom") row.prenom = value ?? "";
      else (row as unknown as Record<string, string | null>)[field] = value;
    });

    if (!row.nom) row.errors.push("Nom manquant");
    if (!row.prenom) row.errors.push("Prénom manquant");
    if (!row.telephone && !row.email) row.errors.push("Ni téléphone ni email");

    const telNorm = normalizePhoneNumber(row.telephone);
    const emailNorm = row.email?.toLowerCase() || null;
    if (telNorm && seenTelephone.has(telNorm)) row.duplicateOfIndex = seenTelephone.get(telNorm)!;
    else if (emailNorm && seenEmail.has(emailNorm)) row.duplicateOfIndex = seenEmail.get(emailNorm)!;
    if (telNorm) seenTelephone.set(telNorm, row.index);
    if (emailNorm) seenEmail.set(emailNorm, row.index);

    rows.push(row);
  }

  return { rows, unknownColumns };
}
