// ============================================================
// P16 - Planning central. Ce module ne fait QUE agréger en lecture des
// données déjà canoniques (Rdv, TransmissionPackage/mission) - aucun
// nouveau modèle de rendez-vous/événement n'est créé ici. Vue par défaut :
// semaine. Le pilotage des statuts de mission reste dans mission-actions.ts
// (updateMissionStatutAction), jamais dupliqué ici.
// ============================================================

export type PlanningVue = "jour" | "semaine" | "mois";

export function parseVue(raw: string | undefined): PlanningVue {
  return raw === "jour" || raw === "mois" ? raw : "semaine";
}

export function parseDate(raw: string | undefined): Date {
  if (raw) {
    const d = new Date(raw + "T00:00:00");
    if (!Number.isNaN(d.getTime())) return d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day; // lundi comme premier jour
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getRange(vue: PlanningVue, date: Date): { start: Date; end: Date } {
  if (vue === "jour") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (vue === "mois") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return { start, end };
  }
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Décale la vue courante d'un cran (jour/semaine/mois) dans un sens donné -
// utilisé par les boutons précédent/suivant.
export function shiftDate(vue: PlanningVue, date: Date, direction: 1 | -1): Date {
  if (vue === "jour") return addDays(date, direction);
  if (vue === "mois") return new Date(date.getFullYear(), date.getMonth() + direction, 1);
  return addDays(date, 7 * direction);
}
