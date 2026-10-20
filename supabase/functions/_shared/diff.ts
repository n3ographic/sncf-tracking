import type { EventKind, EventRow, TripSnapshot } from './types.ts'

// Ordre déterministe des événements : par groupe de type, puis stop_sequence, puis id d'alerte.
const ORDER: EventKind[] = ['first_seen', 'cancelled', 'uncancelled', 'delay', 'stop_cancelled', 'alert_added', 'alert_removed']

// Événements entre deux observations d'un trajet ; prev null = première observation.
// Chaque value se suffit pour rejouer l'historique.
export function diffTrip(prev: TripSnapshot | null, next: TripSnapshot, observedAt: string): EventRow[] {
  const ev: EventRow[] = []
  const push = (kind: EventKind, stop_sequence: number | null, value: Record<string, unknown>) =>
    ev.push({ observed_at: observedAt, service_date: next.serviceDate, trip_id: next.tripId, kind, stop_sequence, value })

  if (!prev) push('first_seen', null, {})
  if (next.cancelled && !prev?.cancelled) push('cancelled', null, {})
  if (!next.cancelled && prev?.cancelled) push('uncancelled', null, {})

  for (const [seq, d] of Object.entries(next.stopDelays)) {
    const before = prev?.stopDelays[seq]
    if (d === before) continue
    const from_s = typeof before === 'number' ? before : null
    if (d === 'cancelled') push('stop_cancelled', Number(seq), { from_s })
    else if (before === 'cancelled') push('delay', Number(seq), { from_s: null, delay_s: d, was_cancelled: true })
    // Première vue d'un arrêt à l'heure : rien à signaler.
    else if (before !== undefined || d !== 0) push('delay', Number(seq), { from_s, delay_s: d })
  }

  const prevAlerts = new Set(prev?.alertIds ?? [])
  const nextAlerts = new Set(next.alertIds)
  for (const id of nextAlerts) if (!prevAlerts.has(id)) push('alert_added', null, { alert_id: id })
  for (const id of prevAlerts) if (!nextAlerts.has(id)) push('alert_removed', null, { alert_id: id })

  const alertId = (e: EventRow) => String(e.value.alert_id ?? '')
  return ev.sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
    (a.stop_sequence ?? 0) - (b.stop_sequence ?? 0) ||
    alertId(a).localeCompare(alertId(b)))
}
