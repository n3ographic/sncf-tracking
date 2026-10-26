import { expect, test } from 'vitest'
import { indexTroncons, tronconFor, uicOf } from '../scripts/lib/troncons-tn.ts'
import type { Lngl } from '../scripts/lib/rail-graph.ts'

// Autour de 47° N : 0,01° de longitude ≈ 760 m.
const feature = (a: string, b: string, coordinates: Lngl[]) => ({ properties: { code_uic_a: a, code_uic_b: b }, geometry: { coordinates } })
const line: Lngl[] = [[2.0, 47.0], [2.05, 47.0], [2.1, 47.0]]
const index = indexTroncons([feature('87000001', '87000002', line)])

test('uicOf : le code UIC est le suffixe de l’identifiant d’arrêt, quelle que soit la marque', () => {
  expect(uicOf('StopPoint:OCEOUIGO-87113001')).toBe('87113001')
  expect(uicOf('StopPoint:OCETGV INOUI-87686006')).toBe('87686006')
})

test('tronçon retrouvé quel que soit l’ordre des gares, et renvoyé tel quel', () => {
  expect(tronconFor(index, '87000001', '87000002', [2.0, 47.0], [2.1, 47.0])).toEqual(line)
  expect(tronconFor(index, '87000002', '87000001', [2.1, 47.0], [2.0, 47.0])).toEqual(line)
})

test('paire inconnue de Train Nomade : null', () => {
  expect(tronconFor(index, '87000001', '87000003', [2.0, 47.0], [2.1, 47.0])).toBeNull()
})

test('extrémités à moins de 1,5 km des gares : accepté ; à plus : refusé (code UIC homonyme)', () => {
  expect(tronconFor(index, '87000001', '87000002', [2.0 + 0.015, 47.0], [2.1, 47.0])).not.toBeNull() // ≈ 1,1 km
  expect(tronconFor(index, '87000001', '87000002', [2.0 + 0.03, 47.0], [2.1, 47.0])).toBeNull() // ≈ 2,3 km
})

test('tracé plus de deux fois plus long que le vol d’oiseau : refusé', () => {
  const long = indexTroncons([feature('87000001', '87000002', [[2.0, 47.0], [2.05, 47.3], [2.1, 47.0]])])
  expect(tronconFor(long, '87000001', '87000002', [2.0, 47.0], [2.1, 47.0])).toBeNull()
})

test('géométrie à moins de deux points : ignorée', () => {
  expect(indexTroncons([feature('87000001', '87000002', [[2.0, 47.0]])]).size).toBe(0)
})
