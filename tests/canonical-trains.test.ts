import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'
const REMOVED = '2026-11-01T09:30:00Z'
let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

// Variantes d'un même train : même numéro, trip_id différents (le réimport de l'horaire en crée une nouvelle).
const trip = (tripId: string, trainNumber: string, circulation?: SeedTrip['circulation'], extra: Partial<SeedTrip> = {}): SeedTrip => ({
  serviceDate: '2026-11-01', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber,
  dep: '2026-11-01T17:00:00Z', arr: '2026-11-01T20:00:00Z', circulation, ...extra,
})
const seed = async (...ts: SeedTrip[]) => { for (const t of ts) await seedTrip(db, t) }
const stats = async (from = '2026-11-01', to = '2026-11-01') => {
  const r = await db.query<{ metric: string; n: string }>(
    'select metric, sum(n)::text as n from public.stats_period($1, $2, $3) group by metric', [from, to, NOW])
  return Object.fromEntries(r.rows.map((x) => [x.metric, Number(x.n)]))
}

test('deux variantes d’un même numéro : un seul train, retard et indemnité de la copie vue en dernier', async () => {
  await seed(
    trip('A:20270114', 'A', { terminusDelayS: 1900, lastSeenAt: '2026-11-01T09:30:00Z' }, { removedAt: REMOVED }),
    trip('A:20270115', 'A', { terminusDelayS: 7300, lastSeenAt: '2026-11-01T21:00:00Z' }),
  )
  const m = await stats()
  expect(m).toMatchObject({ planned: 1, observed: 1, removed_late: 0, circulated: 1, comp_eligible: 1, comp_pct_sum: 50,
    'terminus:120-179': 1, 'cause:sans_cause': 1, 'cause_delay_s:sans_cause': 7300 })
  expect(m['terminus:30-59']).toBeUndefined()
})

test('circulation_measures : une ligne par numéro, celle de la copie vue en dernier', async () => {
  await seed(
    trip('A:20270114', 'A', { terminusDelayS: 1900, lastSeenAt: '2026-11-01T09:30:00Z' }, { removedAt: REMOVED }),
    trip('A:20270115', 'A', { terminusDelayS: 7300, lastSeenAt: '2026-11-01T21:00:00Z' }),
  )
  const r = await db.query<{ trip_id: string }>("select trip_id from public.circulation_measures where train_number = 'A'")
  expect(r.rows.map((x) => x.trip_id)).toEqual(['A:20270115'])
})

test('copie annulée vue en dernier : le train compte comme annulé', async () => {
  await seed(
    trip('B:1', 'B', { terminusDelayS: 1200, lastSeenAt: '2026-11-01T10:00:00Z' }, { removedAt: REMOVED }),
    trip('B:2', 'B', { cancelled: true, terminusDelayS: null, lastSeenAt: '2026-11-01T11:00:00Z' }),
  )
  expect(await stats()).toMatchObject({ planned: 1, observed: 1, cancelled: 1, circulated: 0 })
})

test('circulation sans last_seen_at : celle qui est datée l’emporte', async () => {
  await seed(trip('C:1', 'C', { terminusDelayS: 7300 }), trip('C:2', 'C', { terminusDelayS: 600, lastSeenAt: '2026-11-01T20:10:00Z' }))
  await db.query("update circulations set last_seen_at = null where trip_id = 'C:1'")
  const m = await stats()
  expect(m).toMatchObject({ circulated: 1, 'terminus:5-14': 1 })
  expect(m['terminus:120-179']).toBeUndefined()
})

test('même numéro deux jours de suite : deux trains', async () => {
  await seed(
    trip('D:1', 'D', { terminusDelayS: 0 }, { serviceDate: '2026-10-31', dep: '2026-10-31T17:00:00Z', arr: '2026-10-31T20:00:00Z' }),
    trip('D:2', 'D', { terminusDelayS: 0 }),
  )
  expect((await stats('2026-10-31', '2026-11-01')).circulated).toBe(2)
})

test('toutes les variantes retirées et jamais observées : un train prévu, retiré tard', async () => {
  await seed(trip('E:1', 'E', undefined, { removedAt: REMOVED }), trip('E:2', 'E', undefined, { removedAt: REMOVED }))
  expect(await stats()).toMatchObject({ planned: 1, removed_late: 1, observed: 0 })
})

test('canonical_trips : variante présente, puis import le plus récent', async () => {
  await seed(trip('F:1', 'F', undefined, { removedAt: REMOVED }), trip('F:2', 'F'), trip('F:3', 'F', undefined, { removedAt: REMOVED }),
    trip('G:1', 'G', undefined, { removedAt: REMOVED }), trip('G:2', 'G', undefined, { removedAt: REMOVED }))
  await db.query("update trips_planned set last_import_at = '2026-11-01T08:00:00Z' where trip_id = 'G:2'")
  const r = await db.query<{ train_number: string; trip_id: string }>(
    "select train_number, trip_id from public.canonical_trips where train_number in ('F', 'G') order by train_number")
  expect(r.rows).toEqual([{ train_number: 'F', trip_id: 'F:2' }, { train_number: 'G', trip_id: 'G:2' }])
})

test('anon lit stats_period à travers les vues', async () => {
  await seed(trip('A:1', 'A', { terminusDelayS: 0 }))
  await expect(asAnon(db, () => db.query("select count(*) from public.stats_period('2026-11-01', '2026-11-01', $1)", [NOW]))).resolves.toBeTruthy()
})
