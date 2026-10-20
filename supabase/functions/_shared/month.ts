// Mois calendaires à l'heure de Paris, cohérents avec la purge
// (date_trunc('month', observed_at at time zone 'Europe/Paris')).

// Décalage de Paris (« +02:00 ») le 1er du mois ; aucun changement d'heure ne tombe un 1er.
const parisOffset = (month: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${month}-01T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')!.value.replace('GMT', '') || '+00:00'

// [début du mois, début du mois suivant[ en ISO 8601 avec le décalage de Paris.
export function monthRangeParis(month: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`mois invalide : ${month} (attendu AAAA-MM)`)
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return [`${month}-01T00:00:00${parisOffset(month)}`, `${next}-01T00:00:00${parisOffset(next)}`]
}

// Mois précédant celui de `now` à Paris (AAAA-MM).
export function previousMonthParis(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// Exportable seulement si le mois est terminé à Paris : enregistrer un mois en cours
// laisserait la purge supprimer des events insérés après l'export.
export const isExportableMonth = (month: string, now = new Date()): boolean =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= previousMonthParis(now)
