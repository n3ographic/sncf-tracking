import type { Lngl } from './rail-graph.ts'

// Copie de pairKey (web/lib/traces.ts) : web/ est en CommonJS et ne s'importe pas depuis ce script ESM.
// tests/pair-key.test.ts garantit que les deux restent identiques.
const pt = (p: Lngl) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`

export function pairKey(a: Lngl, b: Lngl): string {
  const [x, y] = [pt(a), pt(b)].sort()
  return `${x}|${y}`
}
