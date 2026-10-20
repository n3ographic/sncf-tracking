// Supervision du collecteur : avertissements d'un passage et contrôle externe de collector_state.

// Passage réussi mais suspect : écrit dans collector_state.last_error (null = rien à signaler).
export function runWarning(r: { tgvEntities: number; matched: number; plannedToday: number }): string | null {
  if (r.plannedToday === 0) return 'avertissement : aucun trajet dans trips_planned pour aujourd’hui (import statique en échec ?)'
  if (r.tgvEntities > 0 && r.matched === 0)
    return `avertissement : ${r.tgvEntities} trajets TGV dans le flux, aucun rapproché du plan (trip_id changés ?)`
  return null
}

export const MAX_SILENCE_MIN = 10

// Contrôle externe (workflow GitHub) : null si le collecteur est sain, sinon le motif.
export function collectorProblem(
  state: { last_run_at: string | null; last_error: string | null } | null,
  now = new Date(),
): string | null {
  if (!state?.last_run_at) return 'collector_state : aucun passage enregistré'
  const minutes = (now.getTime() - Date.parse(state.last_run_at)) / 60_000
  if (minutes > MAX_SILENCE_MIN) return `dernier passage du collecteur il y a ${Math.round(minutes)} min (cron arrêté ou projet en pause ?)`
  if (state.last_error) return `last_error : ${state.last_error}`
  return null
}
