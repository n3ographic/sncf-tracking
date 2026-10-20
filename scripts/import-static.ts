// Import quotidien du GTFS statique : horaires théoriques INOUI/OUIGO pour J, J+1, J+2 (Europe/Paris).
// Usage : npx tsx --env-file=.env.local scripts/import-static.ts (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
import { createClient } from '@supabase/supabase-js'
import { strFromU8, unzipSync } from 'fflate'
import { buildPlanned } from '../supabase/functions/_shared/gtfs-static.ts'

const GTFS_URL = 'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip'
const BATCH = 1000

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Date du jour à Paris (AAAA-MM-JJ), décalée de n jours.
const parisDay = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  return new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10)
}

async function upsert(table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + BATCH), { onConflict })
    if (error) throw new Error(`${table} : ${error.message}`)
  }
  console.log(`${table} : ${rows.length} lignes`)
}

const res = await fetch(GTFS_URL, { signal: AbortSignal.timeout(120_000) })
if (!res.ok) throw new Error(`${GTFS_URL} → HTTP ${res.status}`)
const zip = unzipSync(new Uint8Array(await res.arrayBuffer()))
const txt = (name: string) => {
  const f = zip[`${name}.txt`]
  if (!f) throw new Error(`${name}.txt absent du zip`)
  return strFromU8(f)
}

const dates = [parisDay(0), parisDay(1), parisDay(2)]
const { stops, trips, stopTimes } = buildPlanned({
  agency: txt('agency'), routes: txt('routes'), trips: txt('trips'),
  stop_times: txt('stop_times'), stops: txt('stops'), calendar_dates: txt('calendar_dates'),
}, dates)
console.log(`dates : ${dates.join(', ')}`)

await upsert('stops', stops, 'stop_id')
await upsert('trips_planned', trips, 'service_date,trip_id')
await upsert('stop_times_planned', stopTimes, 'service_date,trip_id,stop_sequence')

const { error } = await db.from('stop_times_planned').delete().lt('service_date', parisDay(-1))
if (error) throw new Error(`purge stop_times_planned : ${error.message}`)
console.log(`stop_times_planned antérieurs au ${parisDay(-1)} supprimés`)
