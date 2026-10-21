import { expect, test } from 'vitest'
import {
  buildGraph, haversineM, nearestNode, shortestPath, simplify, traceBetween, type Lngl, type Troncon,
} from '../scripts/lib/rail-graph.ts'

// Autour de 47° N : 0,0001° de longitude ≈ 7,6 m, 0,0001° de latitude ≈ 11,1 m.
const len = (l: Lngl[]) => l.slice(1).reduce((s, p, i) => s + haversineM(l[i], p), 0)

test('sommets à ~10 m fusionnés : les tronçons se rejoignent ; à ~60 m : non', () => {
  const t1: Troncon = [[2, 47], [2.01, 47]]
  const joined = buildGraph([t1, [[2.01013, 47], [2.02, 47]]])
  const a = nearestNode(joined, [2, 47])!, b = nearestNode(joined, [2.02, 47])!
  expect(shortestPath(joined, a, b)).not.toBeNull()
  const apart = buildGraph([t1, [[2.0108, 47], [2.02, 47]]])
  expect(shortestPath(apart, nearestNode(apart, [2, 47])!, nearestNode(apart, [2.02, 47])!)).toBeNull()
})

test('plus court chemin entre deux branches ; longueur = somme des arêtes', () => {
  const direct: Troncon = [[2.01, 47], [2.02, 47]]
  const detour: Troncon = [[2.01, 47], [2.015, 47.01], [2.02, 47]]
  const g = buildGraph([[[2, 47], [2.01, 47]], direct, detour])
  const path = shortestPath(g, nearestNode(g, [2, 47])!, nearestNode(g, [2.02, 47])!)!
  expect(path).toHaveLength(3)
  expect(len(path)).toBeCloseTo(haversineM([2, 47], [2.02, 47]), -1)
  expect(Math.abs(len(path) / haversineM([2, 47], [2.02, 47]) - 1)).toBeLessThan(0.01)
})

test('nearestNode : plus proche à moins de 1 000 m, null au-delà', () => {
  const g = buildGraph([[[2, 47], [2.1, 47]]])
  expect(nearestNode(g, [2.0001, 47.005])).toBe(nearestNode(g, [2, 47]))
  expect(nearestNode(g, [2, 47.0135])).toBeNull() // ≈ 1 500 m
})

test('simplify : points alignés réduits aux extrémités, coude conservé', () => {
  expect(simplify([[2, 47], [2.005, 47], [2.01, 47]], 30)).toEqual([[2, 47], [2.01, 47]])
  const bent: Lngl[] = [[2, 47], [2.005, 47.001], [2.01, 47]] // écart ≈ 111 m
  expect(simplify(bent, 30)).toEqual(bent)
})

test('traceBetween : tracé direct, même nœud, hors réseau, détour, composantes séparées', () => {
  const line = buildGraph([[[2, 47], [2.05, 47]]])
  const ok = traceBetween(line, [2, 47], [2.05, 47])
  expect(Array.isArray(ok)).toBe(true)
  expect(traceBetween(line, [2, 47], [2.0002, 47])).toEqual({ reason: 'same_node' })
  expect(traceBetween(line, [2, 47.05], [2.05, 47])).toEqual({ reason: 'unsnapped' }) // ≈ 5,5 km

  const u = buildGraph([[[2, 47], [2, 47.1], [2.013, 47.1], [2.013, 47]]])
  expect(traceBetween(u, [2, 47], [2.013, 47])).toEqual({ reason: 'detour' })

  const split = buildGraph([[[2, 47], [2.01, 47]], [[3, 47], [3.01, 47]]])
  expect(traceBetween(split, [2, 47], [3.01, 47])).toEqual({ reason: 'unreachable' })
})
