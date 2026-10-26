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
  const length = line.slice(1).reduce((s, p, i) => s + haversineM(line[i], p), 0)
  return length > MAX_DETOUR * haversineM(a, b) ? null : line
}
