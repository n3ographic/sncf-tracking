// Horaires théoriques depuis le GTFS statique SNCF (TS pur : pas d'API Node ni Deno).
import { axisOf, brandOf, trainNumber } from './classify.ts'
import type { StopRow, StopTimePlannedRow, TripPlannedRow } from './types.ts'

export interface GtfsFiles {
  agency: string; routes: string; trips: string; stop_times: string; stops: string; calendar_dates: string
}

type Row = Record<string, string>

// Découpe une ligne CSV ; champs entre guillemets gérés (« "" » = guillemet).
function splitLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

// ponytail: pas de retour à la ligne dans un champ entre guillemets (absent du flux SNCF).
function parseCsv(text: string): Row[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = splitLine(lines[0])
  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const cells = splitLine(lines[i])
    const row: Row = {}
    header.forEach((h, j) => { row[h] = cells[j] ?? '' })
    rows.push(row)
  }
  return rows
}

const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })

// Décalage UTC de Paris (en minutes) à l'instant ms.
function parisOffsetMin(ms: number): number {
  const name = offsetFmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}

const pad = (n: number) => String(n).padStart(2, '0')

// Heure GTFS (HH:MM:SS, HH pouvant dépasser 24) d'une date de service → ISO avec décalage Europe/Paris.
export function parisIso(serviceDate: string, time: string): string {
  const [y, mo, d] = serviceDate.split('-').map(Number)
  const [h, mi, s] = time.split(':').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi, s) // heure murale lue comme UTC ; normalise le dépassement de 24 h
  // Deux passes : le décalage dépend de l'instant UTC réel, pas de l'heure murale.
  const off = parisOffsetMin(wall - parisOffsetMin(wall) * 60_000)
  const w = new Date(wall)
  const sign = off < 0 ? '-' : '+'
  const a = Math.abs(off)
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

const iso = (date: string, t: string) => (t ? parisIso(date, t) : null)
const num = (v: string) => (v === '' ? null : Number(v))

// Trajets INOUI/OUIGO circulant aux dates données (AAAA-MM-JJ). Calendrier : calendar_dates seul.
export function buildPlanned(files: GtfsFiles, dates: string[]): {
  stops: StopRow[]; trips: TripPlannedRow[]; stopTimes: StopTimePlannedRow[]
} {
  const wanted = new Map(dates.map((d) => [d.replaceAll('-', ''), d]))
  const serviceDates = new Map<string, string[]>()
  for (const r of parseCsv(files.calendar_dates)) {
    const d = wanted.get(r.date)
    if (!d || r.exception_type !== '1') continue
    const list = serviceDates.get(r.service_id) ?? []
    list.push(d)
    serviceDates.set(r.service_id, list)
  }

  const agencies = new Map(parseCsv(files.agency).map((a) => [a.agency_id, a.agency_name]))
  const routes = new Map(parseCsv(files.routes).map((r) => [r.route_id, r]))

  const kept = new Map<string, { brand: NonNullable<ReturnType<typeof brandOf>>; dates: string[] }>()
  for (const t of parseCsv(files.trips)) {
    const ds = serviceDates.get(t.service_id)
    if (!ds) continue
    const route = routes.get(t.route_id)
    const brand = brandOf(agencies.get(route?.agency_id ?? '') ?? '', route?.route_short_name ?? '', t.trip_id)
    if (brand) kept.set(t.trip_id, { brand, dates: ds })
  }

  const byTrip = new Map<string, Row[]>()
  for (const st of parseCsv(files.stop_times)) {
    if (!kept.has(st.trip_id)) continue
    const list = byTrip.get(st.trip_id) ?? []
    list.push(st)
    byTrip.set(st.trip_id, list)
  }

  const stopsById = new Map(parseCsv(files.stops).map((s) => [s.stop_id, s]))
  const usedStops = new Set<string>()
  const trips: TripPlannedRow[] = []
  const stopTimes: StopTimePlannedRow[] = []

  for (const [tripId, { brand, dates: ds }] of kept) {
    const sts = (byTrip.get(tripId) ?? []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    if (!sts.length) continue
    sts.forEach((s) => usedStops.add(s.stop_id))
    const axis = axisOf(sts.map((s) => stopsById.get(s.stop_id)?.stop_name ?? ''))
    const first = sts[0], last = sts[sts.length - 1]
    for (const date of ds) {
      trips.push({
        service_date: date, trip_id: tripId, brand, train_number: String(trainNumber(tripId)), axis,
        origin_stop_id: first.stop_id, dest_stop_id: last.stop_id,
        dep_planned: iso(date, first.departure_time), arr_planned: iso(date, last.arrival_time),
      })
      for (const s of sts) {
        stopTimes.push({
          service_date: date, trip_id: tripId, stop_sequence: Number(s.stop_sequence), stop_id: s.stop_id,
          arr_planned: iso(date, s.arrival_time), dep_planned: iso(date, s.departure_time),
        })
      }
    }
  }

  const stops: StopRow[] = [...usedStops].map((id) => {
    const s = stopsById.get(id)
    return { stop_id: id, name: s?.stop_name ?? id, lat: num(s?.stop_lat ?? ''), lon: num(s?.stop_lon ?? '') }
  })
  return { stops, trips, stopTimes }
}
