import type { Axis, Brand } from './types.ts'

// Numéro de train : chiffres après le préfixe OCE<lettres> (ex. OCESN5537F… → 5537).
export const trainNumber = (tripId: string): number => Number(tripId.match(/^OCE[A-Z]+?(\d+)/)?.[1])

// BRAND_RULES (docs/findings/2026-10-20-sondage-flux.md) : la marque se lit dans le trip_id.
// agencyName et routeShortName ne distinguent rien (agence unique) : gardés pour la signature.
export function brandOf(_agencyName: string, _routeShortName: string, tripId: string): Brand | null {
  const n = trainNumber(tripId)
  if (Number.isNaN(n)) return null
  if (tripId.includes(':OUI:')) return 'INOUI'
  if (!tripId.includes(':OGO:')) return null
  // OUIGO Train Classique (4000-4999) exclu.
  return n >= 4000 && n <= 4999 ? null : 'OUIGO'
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Préfixes des noms normalisés ; seule « Paris Est » commence par « paris est » dans stops.txt.
const PARIS_PREFIXES: [string, Axis][] = [
  ['paris gare du nord', 'NORD'], ['paris nord', 'NORD'],
  ['paris gare de lyon', 'SUD_EST'], ['paris bercy', 'SUD_EST'],
  ['paris montparnasse', 'ATLANTIQUE'],
  ['paris est', 'EST'],
]

// Axe : première gare parisienne rencontrée dans l'ordre des arrêts, sinon INTERSECTEURS.
export function axisOf(stopNames: string[]): Axis {
  for (const name of stopNames) {
    const n = normalize(name)
    const hit = PARIS_PREFIXES.find(([p]) => n.startsWith(p))
    if (hit) return hit[1]
  }
  return 'INTERSECTEURS'
}

// Date de service depuis trip.start_date (AAAAMMJJ) du flux, jamais l'horloge.
export function serviceDateOf(startDate: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(startDate)
  if (!m) throw new Error(`start_date invalide : ${startDate}`)
  return `${m[1]}-${m[2]}-${m[3]}`
}
