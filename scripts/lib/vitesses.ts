// Vitesse maximale nominale (SNCF Réseau) : sélection des lignes parcourues par les TGV et fichier pour la carte.
import { haversineM, simplify, type Lngl } from './rail-graph.ts'

export type VmaxFeature = {
  properties: { code_ligne: string; v_max: string | null; pkd: string | null; pkf: string | null }
  geometry: { type: string; coordinates: Lngl[] } | null
}
export type WebFeature = {
  type: 'Feature'
  properties: { v: number; ligne: string; pkd: string; pkf: string }
  geometry: { type: 'LineString'; coordinates: Lngl[] }
}

// Le champ v_max est du texte dans la source ; 0 ou non numérique = inconnu.
export function parseVmax(s: string | null | undefined): number | null {
  const n = Number((s ?? '').trim())
  return s != null && s.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null
}

const STEP_M = 100
// Points tous les ~100 m le long d'une ligne (les tracés simplifiés n'ont parfois qu'un sommet tous les quelques km).
function* densify(line: Lngl[]): Generator<[Lngl, Lngl]> {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const n = Math.max(1, Math.ceil(haversineM(a, b) / STEP_M))
    for (let k = 0; k < n; k++) {
      const p: Lngl = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
      const q: Lngl = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]
      yield [p, q]
    }
  }
}

// Une ligne est gardée si, toutes sections confondues, au moins minKm de voie longent un tracé à moins de toleranceM.
// Le seuil écarte les lignes qui ne font que croiser un tracé (ponts, passages, gares de bifurcation).
export function selectLines(features: VmaxFeature[], traces: Lngl[][], { toleranceM = 150, minKm = 2 } = {}): Set<string> {
  const cell = 0.01 // ~1 km : la tolérance tient dans les 3×3 cellules voisines
  const key = (p: Lngl) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`
  const grid = new Map<string, Lngl[]>()
  const add = (p: Lngl) => { const k = key(p); grid.set(k, [...(grid.get(k) ?? []), p]) }
  for (const t of traces) {
    for (const [p] of densify(t)) add(p)
    if (t.length) add(t.at(-1)!)
  }
  const near = (p: Lngl) => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (haversineM(p, q) <= toleranceM) return true
    }
    return false
  }
  const metres = new Map<string, number>()
  for (const f of features) {
    if (f.geometry?.type !== 'LineString') continue
    for (const [p, q] of densify(f.geometry.coordinates)) {
      if (near([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])) metres.set(f.properties.code_ligne, (metres.get(f.properties.code_ligne) ?? 0) + haversineM(p, q))
    }
  }
  return new Set([...metres].filter(([, m]) => m >= minKm * 1000).map(([code]) => code))
}

// Toutes les sections des lignes gardées (une ligne n'est jamais affichée à moitié), simplifiées comme les tracés.
export function toWebFeatures(features: VmaxFeature[], keep: Set<string>, toleranceM = 30): { type: 'FeatureCollection'; features: WebFeature[] } {
  const out: WebFeature[] = []
  for (const f of features) {
    const v = parseVmax(f.properties.v_max)
    if (v === null || f.geometry?.type !== 'LineString' || !keep.has(f.properties.code_ligne)) continue
    const coordinates = simplify(f.geometry.coordinates, toleranceM).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as Lngl)
    out.push({ type: 'Feature', properties: { v, ligne: f.properties.code_ligne, pkd: f.properties.pkd ?? '', pkf: f.properties.pkf ?? '' }, geometry: { type: 'LineString', coordinates } })
  }
  return { type: 'FeatureCollection', features: out }
}
