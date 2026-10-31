import { haversineM, type Lngl } from './rail-graph.ts'

// Tronçons « entre deux arrêts » de Train Nomade (OpenStreetMap, ODbL), indexés par paire de codes UIC.
// Ils ne servent qu'aux paires que notre routage SNCF Réseau n'a pas pu tracer.
type TronconFeature = { properties: { code_uic_a: string; code_uic_b: string }; geometry: { coordinates: Lngl[] } }

// Les gares d'une paire peuvent être à 1,5 km de nos arrêts au plus (un code UIC homonyme ou erroné tombe dehors),
// et le tracé ne doit pas dépasser deux fois le vol d'oiseau.
const MAX_ENDPOINT_M = 1500
const MAX_DETOUR = 2

// Identifiant d'arrêt GTFS SNCF : « StopPoint:OCETGV INOUI-87686006 » → « 87686006 ».
export const uicOf = (stopId: string): string => stopId.slice(stopId.lastIndexOf('-') + 1)

const uicKey = (a: string, b: string): string => [a, b].sort().join('>')

export function indexTroncons(features: TronconFeature[]): Map<string, Lngl[]> {
  const index = new Map<string, Lngl[]>()
  for (const f of features) {
    if (f.geometry.coordinates.length >= 2) index.set(uicKey(f.properties.code_uic_a, f.properties.code_uic_b), f.geometry.coordinates)
  }
  return index
}

export function tronconFor(index: Map<string, Lngl[]>, uicA: string, uicB: string, a: Lngl, b: Lngl): Lngl[] | null {
  const line = index.get(uicKey(uicA, uicB))
  if (!line) return null
  const first = line[0], last = line[line.length - 1]
  // Le sens du tracé est libre : on retient le rapprochement le plus proche des deux gares.
  const forward = haversineM(first, a) + haversineM(last, b) <= haversineM(first, b) + haversineM(last, a)
  const [ea, eb] = forward ? [first, last] : [last, first]
  if (haversineM(ea, a) > MAX_ENDPOINT_M || haversineM(eb, b) > MAX_ENDPOINT_M) return null
  return lengthM(line) > MAX_DETOUR * haversineM(a, b) ? null : line
}

const lengthM = (line: Lngl[]) => line.slice(1).reduce((s, p, i) => s + haversineM(line[i], p), 0)
// Une gare intermédiaire doit être au bord du tronçon (Porta Susa est à 88 m de Porta Nuova → Milan).
const MAX_THROUGH_M = 500

// Repli quand la paire manque : morceau d'un tronçon qui passe près des deux gares (gare intermédiaire de Train Nomade),
// orienté de a vers b. Le plus court l'emporte ; même plafond de détour que tronconFor.
// ponytail: parcours de tous les tronçons pour chaque paire manquante (une poignée par build), indexer si elles se multiplient
export function tronconThrough(index: Map<string, Lngl[]>, a: Lngl, b: Lngl): Lngl[] | null {
  const nearest = (line: Lngl[], p: Lngl) => line.reduce((best, q, i) => (haversineM(q, p) < haversineM(line[best], p) ? i : best), 0)
  let found: Lngl[] | null = null
  for (const line of index.values()) {
    const i = nearest(line, a), j = nearest(line, b)
    if (i === j || haversineM(line[i], a) > MAX_THROUGH_M || haversineM(line[j], b) > MAX_THROUGH_M) continue
    const part = i < j ? line.slice(i, j + 1) : line.slice(j, i + 1).reverse()
    if (lengthM(part) <= MAX_DETOUR * haversineM(a, b) && (!found || lengthM(part) < lengthM(found))) found = part
  }
  return found
}
