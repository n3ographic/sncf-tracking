import { expect, test } from 'vitest';
import { makeSegment, pairKey } from '../lib/traces';

const A: [number, number] = [2.3331, 48.8441];
const B: [number, number] = [4.8591, 45.7601];

test('pairKey : identique dans les deux sens, arrondi à 3 décimales', () => {
  expect(pairKey(A, B)).toBe(pairKey(B, A));
  expect(pairKey([2.3331, 48.8441], B)).toBe(pairKey([2.3334, 48.8444], B));
  expect(pairKey([2.3331, 48.8441], B)).not.toBe(pairKey([2.3341, 48.8441], B));
});

test('makeSegment : tracé stocké, inversé dans l’autre sens, repli droit', () => {
  const line: [number, number][] = [[2.333, 48.844], [3.5, 47], [4.859, 45.76]];
  const seg = makeSegment({ pairs: { [pairKey(A, B)]: line } });
  expect(seg(A, B)).toEqual(line);
  expect(seg(B, A)).toEqual([...line].reverse());
  expect(seg(A, [1, 1])).toEqual([A, [1, 1]]);
  expect(makeSegment({ pairs: {} })(A, B)).toEqual([A, B]);
});
