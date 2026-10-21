import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'

let db: PGlite
beforeAll(async () => {
  db = await makeDb()
  await resetData(db)
})
afterEach(async () => {
  await resetData(db)
  await db.exec('truncate daily_stats')
})

// Un train du jour de service `day`, arrivée à 20:00Z : terminé à NOW pour les jours du 31/10 et du 01/11.
const trip = (day: string, tripId: string, circulation?: SeedTrip['circulation'], extra: Partial<SeedTrip> = {}): SeedTrip => ({
  serviceDate: day, tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
  dep: `${day}T19:00:00Z`, arr: `${day}T20:00:00Z`, circulation, ...extra,
})

const rows = async (day?: string) =>
  (await db.query<{ service_date: string; brand: string; axis: string; metric: string; n: string }>(
    `select service_date::text, brand, axis, metric, n::text from daily_stats ${day ? `where service_date = '${day}'` : ''} order by 1, 2, 3, 4`)).rows
const metric = (r: Awaited<ReturnType<typeof rows>>, m: string) => Number(r.find((x) => x.metric === m)?.n)
const snap = async (day: string) => (await db.query<{ n: number }>('select public.snapshot_day($1, $2) as n', [day, NOW])).rows[0].n

test('snapshot_day : décomptes du jour (circulé, annulé)', async () => {
  await seedTrip(db, trip('2026-11-01', 'A', { terminusDelayS: 2400, stopDelays: { '1': 2400 } }))
  await seedTrip(db, trip('2026-11-01', 'B', { cancelled: true, terminusDelayS: null, stopDelays: { '1': 'cancelled' } }))
  expect(await snap('2026-11-01')).toBeGreaterThan(0)
  const r = await rows('2026-11-01')
  expect(metric(r, 'planned')).toBe(2)
  expect(metric(r, 'circulated')).toBe(1)
  expect(metric(r, 'cancelled')).toBe(1)
  expect(metric(r, 'comp_pct_sum')).toBe(25) // 2 400 s ≥ 1 860 s : 25 % pour INOUI
})

test('snapshot_day : idempotent, un recalcul remplace au lieu d’ajouter', async () => {
  await seedTrip(db, trip('2026-11-01', 'A', { terminusDelayS: 2400 }))
  await snap('2026-11-01')
  const first = await rows()
  await snap('2026-11-01')
  expect(await rows()).toEqual(first)
  await db.query(`update circulations set terminus_delay_s = 8000 where trip_id = 'A'`) // 50 % dès 7 200 s
  await snap('2026-11-01')
  const after = await rows('2026-11-01')
  expect(metric(after, 'comp_pct_sum')).toBe(50)
  expect(after.length).toBe(first.length)
})

test('snapshot_day : jour sans train ou train non terminé : rien écrit', async () => {
  expect(await snap('2026-11-01')).toBe(0)
  await seedTrip(db, trip('2026-11-02', 'J', { terminusDelayS: 0 }, { dep: '2026-11-02T10:50:00Z', arr: '2026-11-02T11:50:00Z' })) // pas terminé à 12:00
  expect(await snap('2026-11-02')).toBe(0)
  expect(await rows()).toEqual([])
})

test('snapshot_recent : veille et avant-veille seulement, jamais avant le 2026-10-20', async () => {
  for (const d of ['2026-10-30', '2026-10-31', '2026-11-01']) await seedTrip(db, trip(d, `T${d}`, { terminusDelayS: 0 }))
  await db.query('select public.snapshot_recent($1)', [NOW])
  expect([...new Set((await rows()).map((r) => r.service_date))]).toEqual(['2026-10-31', '2026-11-01'])
  await db.exec('truncate daily_stats')
  await seedTrip(db, trip('2026-10-19', 'old', { terminusDelayS: 0 }))
  await seedTrip(db, trip('2026-10-20', 'first', { terminusDelayS: 0 }))
  await db.query('select public.snapshot_recent($1)', ['2026-10-21T10:00:00Z'])
  expect([...new Set((await rows()).map((r) => r.service_date))]).toEqual(['2026-10-20'])
})

test('cumul_totals : égal à stats_period sur la plage, jours et bornes', async () => {
  await seedTrip(db, trip('2026-10-31', 'A', { terminusDelayS: 2400 }))
  await seedTrip(db, trip('2026-11-01', 'B', { terminusDelayS: 8000 }, { brand: 'OUIGO', axis: 'ATLANTIQUE' }))
  await seedTrip(db, trip('2026-11-01', 'C', { cancelled: true, terminusDelayS: null }))
  await snap('2026-10-31'); await snap('2026-11-01')
  const totals = (await db.query<{ brand: string; metric: string; n: string; days: number; first_day: string; last_day: string }>(
    'select brand, metric, n::text, days, first_day::text, last_day::text from public.cumul_totals() order by 1, 2')).rows
  const direct = (await db.query<{ brand: string; metric: string; n: string }>(
    `select brand, metric, sum(n)::text as n from public.stats_period('2026-10-31', '2026-11-01', $1) group by 1, 2 order by 1, 2`, [NOW])).rows
  expect(totals.map((t) => [t.brand, t.metric, t.n])).toEqual(direct.map((d) => [d.brand, d.metric, d.n]))
  expect(new Set(totals.map((t) => `${t.days}|${t.first_day}|${t.last_day}`))).toEqual(new Set(['2|2026-10-31|2026-11-01']))
})

test('cumul_totals : table vide, aucune ligne', async () => {
  expect((await db.query('select * from public.cumul_totals()')).rows).toEqual([])
})

test('droits : anon lit, n’écrit pas, n’exécute pas les snapshots', async () => {
  await seedTrip(db, trip('2026-11-01', 'A', { terminusDelayS: 0 }))
  await snap('2026-11-01')
  await asAnon(db, async () => {
    expect(Number((await db.query<{ c: string }>('select count(*)::text as c from daily_stats')).rows[0].c)).toBeGreaterThan(0)
    expect((await db.query('select * from public.cumul_totals()')).rows.length).toBeGreaterThan(0)
  })
  for (const sql of [
    `insert into daily_stats values ('2026-11-01','INOUI','EST','x',1)`,
    `update daily_stats set n = 0`,
    `delete from daily_stats`,
    `select public.snapshot_day('2026-11-01')`,
    `select public.snapshot_recent()`,
  ]) {
    await expect(asAnon(db, () => db.query(sql))).rejects.toThrow(/permission denied|row-level security|violates/i)
  }
})
