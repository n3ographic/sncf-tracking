// Précalcul des tracés de voies entre arrêts consécutifs (plan 3b).
// Usage : npm run build:traces  — lit SUPABASE_URL et SUPABASE_ANON_KEY (clé publique) dans l'environnement.
// Écrit web/public/trace-paires.json ; le jeu SNCF Réseau est gardé dans tmp/ (git-ignoré).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { buildGraph, haversineM, simplify, traceBetween, type Lngl, type Troncon } from './lib/rail-graph.ts'
import { pairKey } from './lib/pair-key.ts'

const SOURCE = 'https://data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson'
const CACHE = 'tmp/formes-rfn.geojson'
const OUT = 'web/public/trace-paires.json'
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY
if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY requis (clé publique)')

async function page<T>(table: string, select: string, order: string, offset: number): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${table}?select=${select}&order=${order}&limit=1000&offset=${offset}`, { headers: { apikey: key! } })
  if (!r.ok) throw new Error(`${table} : ${r.status}`)
  return (await r.json()) as T[]
}
async function all<T>(table: string, select: string, order: string): Promise<T[]> {
  const rows: T[] = []
  for (let o = 0; ; o += 1000) {
    const p = await page<T>(table, select, order, o)
    rows.push(...p)
    if (p.length < 1000) return rows
  }
}

// 1. Réseau
if (!existsSync(CACHE)) {
  mkdirSync('tmp', { recursive: true })
  console.log('téléchargement des formes de lignes…')
  const r = await fetch(SOURCE)
  if (!r.ok) throw new Error(`formes de lignes : ${r.status}`)
  writeFileSync(CACHE, Buffer.from(await r.arrayBuffer()))
}
type Feature = { properties: { libelle?: string }; geometry: { type: string; coordinates: any } | null }
const features = (JSON.parse(readFileSync(CACHE, 'utf8')) as { features: Feature[] }).features
const troncons: Troncon[] = []
let neutralised = 0
for (const f of features) {
  if (!f.geometry) continue
  if ((f.properties.libelle ?? '').toLowerCase().startsWith('neutralis')) { neutralised++; continue }
  if (f.geometry.type === 'LineString') troncons.push(f.geometry.coordinates)
  else if (f.geometry.type === 'MultiLineString') troncons.push(...f.geometry.coordinates)
}
// 25 m laissait des coupures aux jonctions (Sète–Agde en 22 fois le vol d'oiseau) ; 60 m les referme.
const MERGE_M = 60
const graph = buildGraph(troncons, MERGE_M)
console.log(`${features.length} tronçons (${neutralised} neutralisés exclus), ${graph.pts.length} nœuds`)

// 2. Paires d'arrêts consécutifs distinctes
const stops = new Map((await all<{ stop_id: string; lat: number | null; lon: number | null }>('stops', 'stop_id,lat,lon', 'stop_id')).map((s) => [s.stop_id, s]))
const times = await all<{ service_date: string; trip_id: string; stop_id: string; stop_sequence: number }>(
  'stop_times_planned', 'service_date,trip_id,stop_id,stop_sequence', 'service_date,trip_id,stop_sequence')
const pairs = new Set<string>()
for (let i = 1; i < times.length; i++) {
  const a = times[i - 1], b = times[i]
  if (a.service_date === b.service_date && a.trip_id === b.trip_id && a.stop_id !== b.stop_id) {
    pairs.add([a.stop_id, b.stop_id].sort().join('>'))
  }
}

// 3. Tracés
const out: Record<string, [number, number][]> = {}
const owner = new Map<string, string>()
const rejected: Record<string, number> = { unsnapped: 0, same_node: 0, unreachable: 0, detour: 0, collision: 0, no_coords: 0 }
const unsnapped = new Set<string>()
const ratios: number[] = []
for (const p of pairs) {
  const [ida, idb] = p.split('>')
  const sa = stops.get(ida), sb = stops.get(idb)
  if (sa?.lon == null || sa.lat == null || sb?.lon == null || sb.lat == null) { rejected.no_coords++; continue }
  const a: Lngl = [sa.lon, sa.lat], b: Lngl = [sb.lon, sb.lat]
  const k = pairKey(a, b)
  if (owner.has(k)) { rejected.collision++; continue } // deux paires d'arrêts aux mêmes coordonnées arrondies
  const t = traceBetween(graph, a, b)
  if (!Array.isArray(t)) {
    rejected[t.reason]++
    if (t.reason === 'unsnapped') unsnapped.add(`${sa.stop_id} / ${sb.stop_id}`)
    continue
  }
  owner.set(k, p)
  const line = simplify(t, 30).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as [number, number])
  out[k] = line
  ratios.push(t.slice(1).reduce((s, q, i) => s + haversineM(t[i], q), 0) / haversineM(a, b))
}

const file = { version: 1, source: 'SNCF Réseau, Fichier de formes des lignes du RFN (ODbL)', generated_at: new Date().toISOString(), pairs: out }
writeFileSync(OUT, JSON.stringify(file))
ratios.sort((x, y) => x - y)
const traced = Object.keys(out).length
// Une paire « collision » (mêmes coordonnées arrondies, ex. INOUI et OUIGO) est couverte par le tracé de sa jumelle.
const covered = traced + rejected.collision
console.log(`paires d'arrêts couvertes : ${covered} / ${pairs.size} (${((100 * covered) / pairs.size).toFixed(1)} %), dont ${traced} clés tracées`)
console.log('rejets :', rejected)
console.log(`rapport tracé / vol d'oiseau : médian ${ratios[Math.floor(ratios.length / 2)]?.toFixed(3)}, maximal ${ratios.at(-1)?.toFixed(3)}`)
console.log(`gares non accrochées (paires) : ${[...unsnapped].join(' ; ') || 'aucune'}`)
console.log(`fichier : ${(statSync(OUT).size / 1024).toFixed(0)} Ko`)
