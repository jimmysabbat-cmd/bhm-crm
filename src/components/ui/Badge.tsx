import type { ReactNode } from "react";

type Color = "slate" | "emerald" | "amber" | "red" | "blue" | "violet";

const colors: Record<Color, string> = {
  slate: "bg-slate-100 text-slate-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
};

export function Badge({
  children,
  color = "slate",
}: {
  children: ReactNode;
  color?: Color;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  );
}

// Heuristique de couleur pour les statuts de dossier à partir de leur clé,
// pour un signal visuel cohérent sans configuration supplémentaire.
export function statutColor(key: string): Color {
  if (key === "CLOTURE" || key === "SOLDE_RECU") return "emerald";
  if (key === "REFUSE") return "red";
  if (key.startsWith("TRAVAUX")) return "blue";
  if (key === "DEVIS_SIGNE" || key === "AUDIT_FAIT") return "slate";
  return "amber";
}
