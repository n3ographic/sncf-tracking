import { expect, test } from 'vitest'
import { pairKey as scriptKey } from '../scripts/lib/pair-key.ts'
import { pairKey as webKey } from '../web/lib/traces.ts'

test('pairKey du script identique à celle du web', () => {
  const pts: [number, number][] = [[2.3331, 48.8441], [4.8591, 45.7601], [-1.5534, 47.2173], [2.3334, 48.8444], [0, 0]]
  for (const a of pts) for (const b of pts) expect(scriptKey(a, b)).toBe(webKey(a, b))
})
