import { expect, test } from 'vitest';
import { VMAX_BANDS, vmaxColorExpr, vmaxText } from '../lib/vitesses';

test('vmaxText : ligne, vitesse et points kilométriques', () => {
  expect(vmaxText({ v: 300, ligne: '752000', pkd: '226+940', pkf: '255+913' })).toBe('LIGNE 752000 · 300 KM/H · PK 226+940 → 255+913');
});

test('vmaxText : sans points kilométriques, pas de « PK » vide', () => {
  expect(vmaxText({ v: 160, ligne: '830000', pkd: '', pkf: '' })).toBe('LIGNE 830000 · 160 KM/H');
});

test('plages : bornes croissantes, et l’expression de couleur les reprend dans l’ordre', () => {
  const from = VMAX_BANDS.map((b) => b.from);
  expect(from).toEqual([0, 100, 160, 220, 300]);
  expect(vmaxColorExpr()).toEqual(['step', ['get', 'v'], VMAX_BANDS[0].color,
    100, VMAX_BANDS[1].color, 160, VMAX_BANDS[2].color, 220, VMAX_BANDS[3].color, 300, VMAX_BANDS[4].color]);
});
