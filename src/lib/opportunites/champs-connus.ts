// ============================================================
// Construit l'ensemble des champs réels déjà connus (convention
// "Logement.xxx"/"Client.xxx", identique à Question.champMappe) - utilisé
// par le Moteur Opportunités ET Next Best Question pour la déduplication
// (audit : la déduplication passe TOUJOURS par ce nom de champ réel,
// jamais par metierConcerne ni par un identifiant de Question).
// ============================================================

export function buildChampsConnus(params: {
  logement?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
}): Set<string> {
  const champs = new Set<string>();
  if (params.logement) {
    for (const [key, value] of Object.entries(params.logement)) {
      if (value !== null && value !== undefined && key !== "id" && !key.endsWith("Id")) champs.add(`Logement.${key}`);
    }
  }
  if (params.client) {
    for (const [key, value] of Object.entries(params.client)) {
      if (value !== null && value !== undefined && key !== "id" && !key.endsWith("Id")) champs.add(`Client.${key}`);
    }
  }
  return champs;
}
