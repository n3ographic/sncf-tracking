// Export d'un mois (heure de Paris) du journal events en CSV gzip : tmp/events-AAAA-MM.csv.gz.
// Usage : npx tsx --env-file=.env.local scripts/export-month.ts AAAA-MM
// Dernière ligne de sortie : ROWS=<n>, lue par le workflow export-month.
import { createClient } from '@supabase/supabase-js'
import { gzipSync, strToU8 } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { toCsv } from '../supabase/functions/_shared/csv.ts'
import { monthRangeParis } from '../supabase/functions/_shared/month.ts'

const COLUMNS = ['id', 'observed_at', 'service_date', 'trip_id', 'kind', 'stop_sequence', 'value']
const PAGE = 10_000

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const month = process.argv[2]
const [from, to] = monthRangeParis(month)

// Pagination par clé (id) : stable même si le collecteur insère pendant l'export.
// On s'arrête sur une page vide, PostgREST pouvant plafonner une page sous PAGE (max-rows).
const rows: Record<string, unknown>[] = []
for (let last = 0; ; ) {
  const { data, error } = await db.from('events').select(COLUMNS.join(','))
    .gte('observed_at', from).lt('observed_at', to).gt('id', last).order('id').limit(PAGE)
  if (error) throw new Error(`events : ${error.message}`)
  if (!data.length) break
  rows.push(...(data as unknown as Record<string, unknown>[]))
  last = rows[rows.length - 1].id as number
}

mkdirSync('tmp', { recursive: true })
const file = `tmp/events-${month}.csv.gz`
writeFileSync(file, gzipSync(strToU8(toCsv(rows, COLUMNS))))
console.log(`${file} : [${from}, ${to}[, id max ${rows.at(-1)?.id ?? '-'}`)
console.log(`ROWS=${rows.length}`)
