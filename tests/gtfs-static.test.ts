import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildPlanned, parisIso } from '../supabase/functions/_shared/gtfs-static.ts'

const read = (f: string) => readFileSync(`tests/fixtures/gtfs-mini/${f}.txt`, 'utf8')
const files = {
  agency: read('agency'), routes: read('routes'), trips: read('trips'),
  stop_times: read('stop_times'), stops: read('stops'), calendar_dates: read('calendar_dates'),
}
const INOUI = 'OCESN8099F1187_F:OUI:FR:Line::A::87391003:87471003:2:2510:20261115'
const OUIGO = 'OCESN7853F1187_F:OGO:FR:Line::B::87686006:87751008:2:1013:20261212'

test('2 trajets INOUI/OUIGO, pas de TER, avec marque et axe', () => {
  const { trips } = buildPlanned(files, ['2026-10-20'])
  expect(trips).toHaveLength(2)
  expect(trips.find((t) => t.trip_id === INOUI)).toEqual({
    service_date: '2026-10-20', trip_id: INOUI, brand: 'INOUI', train_number: '8099', axis: 'ATLANTIQUE',
    origin_stop_id: 'StopPoint:OCETGV INOUI-87391003', dest_stop_id: 'StopPoint:OCETGV INOUI-87471003',
    dep_planned: '2026-10-20T23:05:00+02:00', arr_planned: '2026-10-21T01:10:00+02:00',
  })
  const ouigo = trips.find((t) => t.trip_id === OUIGO)
  expect(ouigo?.brand).toBe('OUIGO')
  expect(ouigo?.axis).toBe('SUD_EST')
})

test('heure GTFS 25:10:00 → lendemain, Europe/Paris', () => {
  const { stopTimes } = buildPlanned(files, ['2026-10-20'])
  const last = stopTimes.find((s) => s.trip_id === INOUI && s.stop_sequence === 1)
  expect(last?.dep_planned).toBe('2026-10-21T01:10:00+02:00')
  expect(stopTimes.filter((s) => s.trip_id === INOUI).map((s) => s.stop_sequence)).toEqual([0, 1])
  expect(stopTimes).toHaveLength(4)
})

test('heure d’hiver : après le passage CEST→CET du 2026-10-25, +01:00', () => {
  const { trips } = buildPlanned(files, ['2026-10-26'])
  expect(trips).toHaveLength(1)
  expect(trips[0].dep_planned).toBe('2026-10-26T23:05:00+01:00')
  expect(parisIso('2026-10-26', '10:00:00')).toBe('2026-10-26T10:00:00+01:00')
  // nuit du changement d'heure : 24:30 le 24 → 00:30 le 25, encore en CEST
  expect(parisIso('2026-10-24', '24:30:00')).toBe('2026-10-25T00:30:00+02:00')
  expect(parisIso('2026-10-25', '12:00:00')).toBe('2026-10-25T12:00:00+01:00')
})

test('date hors calendar_dates → 0 trajet', () => {
  expect(buildPlanned(files, ['2026-10-21'])).toEqual({ stops: [], trips: [], stopTimes: [] })
})

test('stops : seulement ceux des trajets importés', () => {
  const { stops } = buildPlanned(files, ['2026-10-20'])
  expect(stops.map((s) => s.stop_id).sort()).toEqual([
    'StopPoint:OCEOUIGO-87686006', 'StopPoint:OCEOUIGO-87751008',
    'StopPoint:OCETGV INOUI-87391003', 'StopPoint:OCETGV INOUI-87471003',
  ])
  expect(stops.find((s) => s.stop_id === 'StopPoint:OCETGV INOUI-87471003')).toEqual({
    stop_id: 'StopPoint:OCETGV INOUI-87471003', name: 'Rennes', lat: 48.1, lon: -1.67,
  })
})
