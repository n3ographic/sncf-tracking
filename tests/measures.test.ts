import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'

let db: PGlite
beforeAll(async () => {
  db = await makeDb()
  await resetData(db)
})
afterEach(async () => { await resetData(db) })

const buckets = async (db: PGlite, delays: number[]) =>
  (await db.query<{ b: string }>('select public.delay_bucket(d) as b from unnest($1::int[]) with ordinality u(d, i) order by i', [delays])).rows.map(r => r.b)
const pcts = async (db: PGlite, brand: string, delays: number[]) =>
  (await db.query<{ p: number }>('select public.compensation_pct($1, d) as p from unnest($2::int[]) with ordinality u(d, i) order by i', [brand, delays])).rows.map(r => r.p)
const maxDelays = async (db: PGlite, durations: number[]) =>
  (await db.query<{ m: number }>('select public.regularity_max_delay_s(d) as m from unnest($1::int[]) with ordinality u(d, i) order by i', [durations])).rows.map(r => r.m)

type Row = { brand: string; axis: string; metric: string; n: unknown }
const stats = async (db: PGlite, from: string, to: string) =>
  (await db.query<Row>('select * from public.stats_period($1, $2, $3) order by brand, axis, metric', [from, to, NOW])).rows
const metrics = (rows: Row[], brand: string, axis: string) =>
  Object.fromEntries(rows.filter(r => r.brand === brand && r.axis === axis).map(r => [r.metric, Number(r.n)]))

// Jour de service 2026-11-01, arrivée le soir du 1er : terminé à NOW.
const ARR = '2026-11-01T20:00:00Z'
const trip = (tripId: string, durationS: number, circulation?: SeedTrip['circulation'], extra: Partial<SeedTrip> = {}): SeedTrip => ({
  serviceDate: '2026-11-01', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
  dep: new Date(Date.parse(ARR) - durationS * 1000).toISOString(), arr: ARR, circulation, ...extra,
})

async function seedDataset(db: PGlite) {
  const trips: SeedTrip[] = [
    trip('A', 3600, { terminusDelayS: 240, stopDelays: { '1': 0, '2': 240 } }),
    trip('B', 3600, { terminusDelayS: 300, stopDelays: { '1': 300 } }),
    trip('C', 7200, { terminusDelayS: 540 }),
    trip('D', 14400, { terminusDelayS: 900 }),
    trip('E', 3600, { cancelled: true, terminusDelayS: null, stopDelays: { '1': 'cancelled', '2': 'cancelled' } }),
    trip('F', 3600, { terminusDelayS: null }),
    trip('G', 7200, { terminusDelayS: 7200 }),
    trip('H', 3600, undefined, { removedAt: '2026-11-01T08:00:00Z' }),
    trip('I', 3600),
    // Non terminé à NOW : 11:50 + 0 + 30 min > 12:00.
    trip('J', 3600, { terminusDelayS: 0 }, { serviceDate: '2026-11-02', dep: '2026-11-02T10:50:00Z', arr: '2026-11-02T11:50:00Z' }),
    trip('K', 7200, { terminusDelayS: 3300 }, { brand: 'OUIGO', axis: 'ATLANTIQUE' }),
  ]
  for (const t of trips) await seedTrip(db, t)
}

test('delay_bucket aux bornes', async () => {
  const d = [0, 60, 240, 300, 840, 900, 1740, 1800, 3540, 3600, 7140, 7200, 10740, 10800]
  expect(await buckets(db, d)).toEqual(['0', '1-4', '1-4', '5-14', '5-14', '15-29', '15-29', '30-59', '30-59', '60-119', '60-119', '120-179', '120-179', '180+'])
})

test('compensation_pct aux bornes', async () => {
  expect(await pcts(db, 'INOUI', [1800, 1860, 7140, 7200, 10800, 10860])).toEqual([0, 25, 25, 50, 50, 75])
  expect(await pcts(db, 'OUIGO', [3540, 3600, 7140, 7200])).toEqual([0, 25, 25, 50])
  expect(await pcts(db, 'TER', [7200])).toEqual([0])
})

test('regularity_max_delay_s aux bornes', async () => {
  expect(await maxDelays(db, [5399, 5400, 10800, 10801])).toEqual([300, 600, 600, 900])
})

test('métriques INOUI SUD_EST', async () => {
  await seedDataset(db)
  const rows = await stats(db, '2026-11-01', '2026-11-02')
  expect(metrics(rows, 'INOUI', 'SUD_EST')).toMatchObject({
    planned: 9, observed: 7, removed_late: 1, never_observed: 1, cancelled: 1, no_terminus: 1,
    circulated: 5, on_time_official: 2, comp_eligible: 1, comp_pct_sum: 50,
    'terminus:1-4': 1, 'terminus:5-14': 2, 'terminus:15-29': 1, 'terminus:120-179': 1,
    'stop:0': 1, 'stop:1-4': 1, 'stop:5-14': 1, 'stop:cancelled': 2 })
})

test('métriques OUIGO ATLANTIQUE : barème propre à la marque', async () => {
  await seedDataset(db)
  const rows = await stats(db, '2026-11-01', '2026-11-02')
  expect(metrics(rows, 'OUIGO', 'ATLANTIQUE')).toMatchObject({ planned: 1, observed: 1, circulated: 1,
    on_time_official: 0, comp_eligible: 0, comp_pct_sum: 0, 'terminus:30-59': 1 })
})

test('identités : planned = observed + removed_late + never_observed ; observed = cancelled + no_terminus + circulated ; somme des terminus:* = circulated', async () => {
  await seedDataset(db)
  const rows = await stats(db, '2026-11-01', '2026-11-02')
  const groups = [...new Set(rows.map(r => `${r.brand}|${r.axis}`))]
  expect(groups).toHaveLength(2)
  for (const g of groups) {
    const [brand, axis] = g.split('|')
    const m = metrics(rows, brand, axis)
    expect(m.planned).toBe(m.observed + m.removed_late + m.never_observed)
    expect(m.observed).toBe(m.cancelled + m.no_terminus + m.circulated)
    const terminus = Object.entries(m).filter(([k]) => k.startsWith('terminus:')).reduce((s, [, n]) => s + n, 0)
    expect(terminus).toBe(m.circulated)
  }
})

test('train à cheval sur minuit : rattaché au jour de service du départ', async () => {
  // Départ 23:30 Paris le 01, arrivée 01:10 Paris le 02 (heure d'hiver, UTC+1) : durée 6 000 s, seuil 600 s.
  await seedTrip(db, { serviceDate: '2026-11-01', tripId: 'M', brand: 'INOUI', axis: 'SUD_EST', trainNumber: 'M',
    dep: '2026-11-01T22:30:00Z', arr: '2026-11-02T00:10:00Z', circulation: { terminusDelayS: 0 } })
  const m = metrics(await stats(db, '2026-11-01', '2026-11-01'), 'INOUI', 'SUD_EST')
  expect(m).toMatchObject({ planned: 1, circulated: 1, on_time_official: 1, 'terminus:0': 1 })
  expect(await stats(db, '2026-11-02', '2026-11-02')).toEqual([])
})

test('période sans train : aucune ligne, pas d’erreur', async () => {
  await seedDataset(db)
  expect(await stats(db, '2030-01-01', '2030-01-02')).toEqual([])
})

test('anon peut appeler stats_period', async () => {
  await seedDataset(db)
  const asSuper = await stats(db, '2026-11-01', '2026-11-02')
  expect(asSuper.length).toBeGreaterThan(0)
  expect(await asAnon(db, () => stats(db, '2026-11-01', '2026-11-02'))).toEqual(asSuper)
})
