// Enregistre un export publié dans la table exports, ce qui autorise la purge de ce mois.
// À lancer seulement après la création de la release. Usage : scripts/record-export.ts AAAA-MM <url> <lignes>
import { createClient } from '@supabase/supabase-js'
import { monthRangeParis } from '../supabase/functions/_shared/month.ts'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const [month, url, rows] = process.argv.slice(2)
monthRangeParis(month) // valide AAAA-MM
if (!url?.startsWith('https://') || !/^\d+$/.test(rows ?? '')) throw new Error('usage : record-export.ts AAAA-MM <url> <lignes>')

// insert (pas upsert) : un mois déjà enregistré fait échouer le job.
const { error } = await db.from('exports').insert({ month: `${month}-01`, release_url: url, row_count: Number(rows) })
if (error) throw new Error(`exports : ${error.message}`)
console.log(`exports : ${month} enregistré (${rows} lignes)`)
