// Contrôle externe du collecteur : échoue si le dernier passage date de plus de 10 min ou si last_error est renseigné.
// Usage : npx tsx --env-file=.env.local scripts/check-collector.ts (lancé chaque nuit par import-static.yml).
import { createClient } from '@supabase/supabase-js'
import { collectorProblem } from '../supabase/functions/_shared/health.ts'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data, error } = await db.from('collector_state').select('last_run_at, last_error').eq('id', 1).maybeSingle()
if (error) throw new Error(`collector_state : ${error.message}`)
const problem = collectorProblem(data)
if (problem) throw new Error(problem)
console.log(`collecteur sain : dernier passage ${data!.last_run_at}`)
