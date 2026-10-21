import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip } from './sql/harness.ts'

let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

// Table → une colonne pour l'UPDATE. Le refus de privilège précède toute contrainte et toute RLS.
const TABLES: Record<string, string> = {
  stops: 'name', trips_planned: 'train_number', stop_times_planned: 'stop_id', circulations: 'cause',
  events: 'trip_id', exports: 'release_url', collector_state: 'last_error',
  compensation_scale: 'pct', regularity_rule: 'source_url', reference_prices: 'seats',
}

test.each(Object.entries(TABLES))('anon : insert, update, delete et truncate refusés par privilège sur %s', async (table, col) => {
  const denied = /permission denied/
  await asAnon(db, async () => {
    await expect(db.query(`insert into ${table} default values`)).rejects.toThrow(denied)
    await expect(db.query(`update ${table} set ${col} = ${col}`)).rejects.toThrow(denied)
    await expect(db.query(`delete from ${table}`)).rejects.toThrow(denied)
    await expect(db.query(`truncate ${table}`)).rejects.toThrow(denied)
  })
})

// Vue non modifiable : Postgres refuse avant le contrôle de privilège, on vérifie donc les droits eux-mêmes.
test('anon et authenticated : aucun droit d’écriture sur la vue circulation_measures, SELECT conservé', async () => {
  const { rows } = await db.query(`select r,
      has_table_privilege(r, 'public.circulation_measures', 'INSERT, UPDATE, DELETE, TRUNCATE') as write,
      has_table_privilege(r, 'public.circulation_measures', 'SELECT') as read
    from unnest(array['anon', 'authenticated']) r`)
  expect(rows).toEqual([{ r: 'anon', write: false, read: true }, { r: 'authenticated', write: false, read: true }])
})

async function seed() {
  await seedTrip(db, { serviceDate: '2026-10-21', tripId: 't1', brand: 'INOUI', axis: 'SUD_EST', trainNumber: '6101',
    dep: '2026-10-21T06:00:00Z', arr: '2026-10-21T08:00:00Z', circulation: { terminusDelayS: 0 },
    stops: [{ seq: 1, stopId: 'A', name: 'Paris', lat: 48.8, lon: 2.3, arr: '2026-10-21T06:00:00Z', dep: '2026-10-21T06:00:00Z' }] })
  await db.query(`insert into exports (month, release_url, row_count) values ('2026-10-01', 'u', 1)`)
}

test('anon lit toujours les tables publiques et la vue, et appelle les fonctions du plan 2', async () => {
  await seed()
  const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n
  await asAnon(db, async () => {
    for (const t of ['stops', 'trips_planned', 'stop_times_planned', 'circulations', 'exports',
      'compensation_scale', 'regularity_rule', 'reference_prices', 'circulation_measures']) {
      expect(await count(t), t).toBeGreaterThan(0)
    }
    await db.query(`select finished_margin(), delay_bucket(0), compensation_pct('INOUI', 0), regularity_max_delay_s(0),
      circulation_finished(now(), 0, false, now())`)
    await db.query(`select * from stats_period('2026-10-21', '2026-10-21')`)
    await db.query(`select live_trains()`)
  })
})

test('service_role écrit toujours', async () => {
  await db.exec('set role service_role')
  try {
    await db.query(`insert into stops (stop_id, name) values ('Z', 'z')`)
    await db.query(`update stops set name = 'y' where stop_id = 'Z'`)
    await db.query(`delete from stops where stop_id = 'Z'`)
  } finally { await db.exec('reset role') }
})
