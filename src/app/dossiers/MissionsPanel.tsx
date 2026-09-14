"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatCents } from "@/lib/money";
import { updateMissionStatutAction, type MissionRow } from "./mission-actions";

// P16 - visibilité + pilotage des missions (ST ou régie) déjà envoyées
// pour ce dossier, tout poste confondu (cockpit). Le partenaire garde son
// propre accepter/refuser (/partenaire) ; ce panneau sert au pilotage
// interne (PLANIFIEE/EN_COURS/TERMINEE), y compris pour une équipe
// interne qui n'a pas de portail pour répondre elle-même.

const STATUT_LABELS: Record<string, string> = {
  ENVOYEE: "Envoyée",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  PLANIFIEE: "Planifiée",
  EN_COURS: "En cours",
  TERMINEE: "Terminée",
  ANNULE: "Annulée",
};
const STATUT_COLORS: Record<string, "emerald" | "blue" | "red" | "amber" | "slate"> = {
  ENVOYEE: "blue",
  ACCEPTEE: "emerald",
  REFUSEE: "red",
  PLANIFIEE: "blue",
  EN_COURS: "amber",
  TERMINEE: "emerald",
  ANNULE: "slate",
};
const STATUTS_PILOTABLES = ["ENVOYEE", "ACCEPTEE", "PLANIFIEE", "EN_COURS", "TERMINEE"] as const;

function MissionRowItem({ mission, posteLabel }: { mission: MissionRow; posteLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(mission.status);
  const pilotable = status !== "REFUSEE" && status !== "ANNULE";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm first:border-t-0">
      <div>
        <div className="font-medium text-slate-900">
          {mission.destinataireNom} <span className="text-slate-400">({mission.destinataireType === "REGIE" ? "équipe interne" : "sous-traitant"})</span>
        </div>
        <div className="text-xs text-slate-500">
          {posteLabel}
          {(mission.dateDebutSouhaitee || mission.dateFinSouhaitee) && (
            <>
              {" · "}
              {mission.dateDebutSouhaitee ? new Date(mission.dateDebutSouhaitee).toLocaleDateString("fr-FR") : "—"} →{" "}
              {mission.dateFinSouhaitee ? new Date(mission.dateFinSouhaitee).toLocaleDateString("fr-FR") : "—"}
            </>
          )}
          {mission.prixConvenuCts != null && <> · {formatCents(mission.prixConvenuCts)}</>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pilotable ? (
          <select
            value={status}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value as (typeof STATUTS_PILOTABLES)[number];
              setStatus(next);
              startTransition(async () => {
                await updateMissionStatutAction(mission.id, next);
              });
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {STATUTS_PILOTABLES.map((s) => (
              <option key={s} value={s}>
                {STATUT_LABELS[s]}
              </option>
            ))}
          </select>
        ) : (
          <Badge color={STATUT_COLORS[status] ?? "slate"}>{STATUT_LABELS[status] ?? status}</Badge>
        )}
      </div>
    </div>
  );
}

export function MissionsPanel({ missions, posteLabels }: { missions: MissionRow[]; posteLabels: Record<string, string> }) {
  if (missions.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Missions ({missions.length})</div>
      <div>
        {missions.map((m) => (
          <MissionRowItem key={m.id} mission={m} posteLabel={m.posteTravauxId ? (posteLabels[m.posteTravauxId] ?? "Poste") : "Poste"} />
        ))}
      </div>
    </div>
  );
}
