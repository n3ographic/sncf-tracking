import { expect, test } from 'vitest';
import { VMAX_BANDS, vmaxColorExpr } from '../lib/vitesses';

test('plages : bornes croissantes, et l’expression de couleur les reprend dans l’ordre', () => {
  const from = VMAX_BANDS.map((b) => b.from);
  expect(from).toEqual([0, 100, 160, 220, 300]);
  expect(vmaxColorExpr()).toEqual(['step', ['get', 'v'], VMAX_BANDS[0].color,
    100, VMAX_BANDS[1].color, 160, VMAX_BANDS[2].color, 220, VMAX_BANDS[3].color, 300, VMAX_BANDS[4].color]);
});
