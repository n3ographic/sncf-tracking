import { expect, test } from 'vitest'
import { parseVmax, selectLines, toWebFeatures, type VmaxFeature } from '../scripts/lib/vitesses.ts'
import type { Lngl } from '../scripts/lib/rail-graph.ts'

// Autour de 47° N : 0,01° de longitude ≈ 760 m, 0,01° de latitude ≈ 1 110 m.
const f = (code: string, v: string, coordinates: Lngl[]): VmaxFeature =>
  ({ properties: { code_ligne: code, v_max: v }, geometry: { type: 'LineString', coordinates } })
const lgv: Lngl[] = [[2.0, 47.0], [2.05, 47.0], [2.1, 47.0]] // ~7,6 km d'ouest en est
const trace: Lngl[] = [[2.0, 47.0005], [2.1, 47.0005]] // parallèle à ~55 m, deux sommets seulement

test('parseVmax : texte numérique converti, le reste écarté', () => {
  expect(parseVmax('300')).toBe(300)
  expect(parseVmax(' 160 ')).toBe(160)
  expect(parseVmax('')).toBeNull()
  expect(parseVmax(null)).toBeNull()
  expect(parseVmax('NC')).toBeNull()
  expect(parseVmax('0')).toBeNull()
})

test('selectLines : une ligne longée par un tracé est gardée, même si le tracé a peu de sommets', () => {
  expect(selectLines([f('752000', '300', lgv)], [trace])).toEqual(new Set(['752000']))
})

test('selectLines : une ligne qui ne fait que croiser un tracé (pont, passage) est écartée', () => {
  const crossing = f('830000', '160', [[2.05, 46.98], [2.05, 47.0], [2.05, 47.02]])
  expect(selectLines([crossing], [trace])).toEqual(new Set())
})

test('selectLines : une ligne loin des tracés est écartée', () => {
  expect(selectLines([f('470000', '160', [[3.0, 48.0], [3.1, 48.0]])], [trace])).toEqual(new Set())
})

test('selectLines : le recoupement se cumule sur toutes les sections d’une même ligne', () => {
  const a = f('005000', '320', [[2.0, 47.0], [2.012, 47.0]]) // ~0,9 km chacune
  const b = f('005000', '300', [[2.012, 47.0], [2.024, 47.0]])
  const c = f('005000', '300', [[2.024, 47.0], [2.036, 47.0]])
  expect(selectLines([a, b, c], [trace], { minKm: 2 })).toEqual(new Set(['005000']))
  expect(selectLines([a], [trace], { minKm: 2 })).toEqual(new Set())
})

test('toWebFeatures : seules les lignes gardées, toutes leurs sections, vitesse seule et coordonnées arrondies', () => {
  const kept = f('752000', '300', [[2.000012, 47.000049], [2.05, 47.0], [2.1, 47.000001]])
  const sibling = f('752000', '270', [[2.1, 47.0], [2.2, 47.0]]) // loin du tracé, mais même ligne
  const other = f('470000', '160', [[3.0, 48.0], [3.1, 48.0]])
  const bad = f('752000', 'NC', [[2.0, 47.0], [2.1, 47.0]])
  const fc = toWebFeatures([kept, sibling, other, bad], new Set(['752000']))
  expect(fc.features).toHaveLength(2)
  expect(fc.features[0]).toEqual({
    type: 'Feature',
    properties: { v: 300 },
    geometry: { type: 'LineString', coordinates: [[2.0, 47.0], [2.1, 47.0]] },
  })
  expect(fc.features[1].properties.v).toBe(270)
})
