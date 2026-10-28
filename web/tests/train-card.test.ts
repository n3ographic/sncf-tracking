import { expect, test } from 'vitest';
import { compensationView, delayBounds, observedAgo, speedView, thresholdProgress, type Rules } from '../lib/train-card';

const rules: Rules = {
  compensation_scale: [
    { brand: 'INOUI', from_s: 1860, pct: 25, source_url: '', source_as_of: '' },
    { brand: 'INOUI', from_s: 7200, pct: 50, source_url: '', source_as_of: '' },
    { brand: 'OUIGO', from_s: 3600, pct: 25, source_url: '', source_as_of: '' },
  ],
  prices: [{ brand: 'INOUI', price_eur_ht: 46.6, seats: 556, price_source: '', seats_source: '', as_of: '' }],
};

test('delayBounds : le retard réel est à moins de 299 s du retard publié, jamais négatif', () => {
  expect(delayBounds(1200)).toEqual({ low_s: 901, high_s: 1499 });
  expect(delayBounds(0)).toEqual({ low_s: 0, high_s: 299 });
});

test('compensationView : pourcentage et euros en fourchette, prochain seuil', () => {
  const v = compensationView('INOUI', 1200, rules)!;
  expect(v).toMatchObject({ pct_low: 0, pct_high: 0, eur_low: 0, eur_high: 0 });
  expect(v.next).toEqual({ from_s: 1860, pct: 25, in_s: 660 });
});

test('compensationView : l’incertitude chevauche un seuil', () => {
  const v = compensationView('INOUI', 1800, rules)!; // réel entre 1501 et 2099 s : le seuil de 1860 s est dans la fourchette
  expect(v.pct_low).toBe(0);
  expect(v.pct_high).toBe(25);
  expect(v.eur_high).toBeCloseTo(11.65, 2);
});

test('compensationView : dernier palier atteint, marque sans prix, retard absent', () => {
  expect(compensationView('INOUI', 9000, rules)!.next).toBeNull();
  expect(compensationView('OUIGO', 4000, rules)).toBeNull(); // prix de référence absent
  expect(compensationView('INOUI', undefined, rules)!.pct_high).toBe(0);
});

test('observedAgo : minutes depuis la dernière observation, absent si inconnue', () => {
  const now = new Date('2026-10-26T18:00:00Z');
  expect(observedAgo('2026-10-26T17:57:10Z', now)).toBe(3);
  expect(observedAgo('2026-10-26T18:00:30Z', now)).toBe(0);
  expect(observedAgo(undefined, now)).toBeNull();
});

test('thresholdProgress : avancement du retard entre le palier en cours et le prochain seuil', () => {
  // INOUI : 0 → 1860 s (25 %) → 7200 s (50 %)
  expect(thresholdProgress('INOUI', 930, rules)).toEqual({ from_s: 0, to_s: 1860, ratio: 0.5 });
  expect(thresholdProgress('INOUI', 1860, rules)).toEqual({ from_s: 1860, to_s: 7200, ratio: 0 });
  expect(thresholdProgress('INOUI', 4530, rules)!.ratio).toBeCloseTo(0.5, 5);
  expect(thresholdProgress('INOUI', 9000, rules)).toBeNull(); // dernier palier
  expect(thresholdProgress('INOUI', undefined, rules)).toEqual({ from_s: 0, to_s: 1860, ratio: 0 });
  expect(thresholdProgress('AUTRE', 100, rules)).toBeNull(); // marque sans barème
});

test('speedView : sous 60 km/h la moyenne d’un tronçon court n’est pas une vitesse de TGV', () => {
  expect(speedView(null)).toEqual({ kind: 'none' });
  expect(speedView(27)).toEqual({ kind: 'short' });
  expect(speedView(59.9)).toEqual({ kind: 'short' });
  expect(speedView(60)).toEqual({ kind: 'speed', kmh: 60 });
  expect(speedView(212.4)).toEqual({ kind: 'speed', kmh: 212 });
});
