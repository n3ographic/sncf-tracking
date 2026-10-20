import { expect, test } from 'vitest'
import { diffTrip } from '../supabase/functions/_shared/diff.ts'
import type { TripSnapshot } from '../supabase/functions/_shared/types.ts'

const base: TripSnapshot = { serviceDate: '2026-10-20', tripId: 'T1', cancelled: false, stopDelays: { '1': 0, '2': 300 }, alertIds: [] }
test('première observation → first_seen + un delay par arrêt non nul', () => {
  const ev = diffTrip(null, base, 'now')
  expect(ev.map(e => e.kind)).toEqual(['first_seen', 'delay'])
  expect(ev[1]).toMatchObject({ stop_sequence: 2, value: { delay_s: 300 } })
})
test('idempotent : même snapshot → aucun événement', () => {
  expect(diffTrip(base, structuredClone(base), 'now')).toEqual([])
})
test('changement de retard → un seul delay avec ancien et nouveau', () => {
  const ev = diffTrip(base, { ...base, stopDelays: { '1': 0, '2': 600 } }, 'now')
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ kind: 'delay', stop_sequence: 2, value: { from_s: 300, delay_s: 600 } })
})
test('suppression, puis rétablissement', () => {
  const c = { ...base, cancelled: true }
  expect(diffTrip(base, c, 'now').map(e => e.kind)).toEqual(['cancelled'])
  expect(diffTrip(c, base, 'now').map(e => e.kind)).toEqual(['uncancelled'])
})
test('arrêt supprimé et alertes', () => {
  const n = { ...base, stopDelays: { '1': 0, '2': 'cancelled' as const }, alertIds: ['A1'] }
  expect(diffTrip(base, n, 'now').map(e => e.kind).sort()).toEqual(['alert_added', 'stop_cancelled'])
  expect(diffTrip(n, { ...n, alertIds: [] }, 'now').map(e => e.kind)).toEqual(['alert_removed'])
})

test('première observation complète, ordre déterministe et valeurs rejouables', () => {
  const n: TripSnapshot = { ...base, cancelled: true, stopDelays: { '10': 120, '2': 60, '3': 'cancelled' }, alertIds: ['A2', 'A1'] }
  const ev = diffTrip(null, n, 'T0')
  expect(ev.map(e => [e.kind, e.stop_sequence])).toEqual([
    ['first_seen', null], ['cancelled', null], ['delay', 2], ['delay', 10], ['stop_cancelled', 3],
    ['alert_added', null], ['alert_added', null],
  ])
  expect(ev[2].value).toEqual({ from_s: null, delay_s: 60 })
  expect(ev[4].value).toEqual({ from_s: null })
  expect(ev.slice(5).map(e => e.value.alert_id)).toEqual(['A1', 'A2'])
  expect(ev[0]).toMatchObject({ observed_at: 'T0', service_date: '2026-10-20', trip_id: 'T1' })
})

test('arrêt rétabli après suppression → delay avec was_cancelled', () => {
  const p: TripSnapshot = { ...base, stopDelays: { '1': 0, '2': 'cancelled' } }
  const ev = diffTrip(p, { ...base, stopDelays: { '1': 0, '2': 0 } }, 'now')
  expect(ev).toEqual([{ observed_at: 'now', service_date: '2026-10-20', trip_id: 'T1', kind: 'delay', stop_sequence: 2, value: { from_s: null, delay_s: 0, was_cancelled: true } }])
  expect(diffTrip(base, { ...base, stopDelays: { '1': 0, '2': 'cancelled' } }, 'now')[0].value).toEqual({ from_s: 300 })
})
