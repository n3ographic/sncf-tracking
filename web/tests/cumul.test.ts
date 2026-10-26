import { expect, test } from 'vitest';
import { shapeCumul, type CumulRow } from '../lib/cumul';
import { prices } from './fixtures';

const row = (brand: string, metric: string, n: number | string, over: Partial<CumulRow> = {}): CumulRow =>
  ({ brand, metric, n, days: 3, first_day: '2026-10-20', last_day: '2026-10-22', ...over });
const rows: CumulRow[] = [
  row('INOUI', 'planned', 100), row('INOUI', 'observed', '40'), row('INOUI', 'circulated', 38), row('INOUI', 'comp_eligible', 5), row('INOUI', 'comp_pct_sum', 125),
  row('OUIGO', 'planned', 50), row('OUIGO', 'observed', 10), row('OUIGO', 'circulated', 9), row('OUIGO', 'comp_eligible', 1), row('OUIGO', 'comp_pct_sum', 100),
  row('INOUI', 'terminus:0', 30), // métrique ignorée
];

test('shapeCumul : couverture, comptes, coûts à l’occupation et à rames pleines', () => {
  const c = shapeCumul(rows, prices);
  expect(c).toMatchObject({ since: '2026-10-20', through: '2026-10-22', days: 3, planned: 150, observed: 50, circulated: 47, comp_eligible: 6, coverage_pct: 33.3 });
  // INOUI : 125 % × 46,6 × 556 = 32 387 ; OUIGO : 100 % × 34,2 × 634 = 21 682,8 ; × 0,75 à l'occupation de référence
  expect(c.cost_eur_ht_at_full_occupancy).toBe(54069.8);
  expect(c.cost_eur_ht).toBe(40552.35);
  expect(c.by_brand.map((b) => b.brand)).toEqual(['INOUI', 'OUIGO']);
  expect(c.by_brand[0]).toMatchObject({ planned: 100, observed: 40, circulated: 38, comp_pct_sum: 125, cost_eur_ht_at_full_occupancy: 32387, cost_eur_ht: 24290.25 });
  expect(c.assumptions.occupancy).toBe(0.75);
  expect(c.assumptions.prices).toHaveLength(2);
});

test('shapeCumul : autre occupation, coût proportionnel', () => {
  const c = shapeCumul(rows, prices, 0.5);
  expect(c.cost_eur_ht).toBe(27034.9);
  expect(c.assumptions.occupancy).toBe(0.5);
});

test('shapeCumul : aucune ligne, compteurs à zéro, couverture nulle', () => {
  const c = shapeCumul([], prices);
  expect(c).toMatchObject({ since: null, through: null, days: 0, planned: 0, observed: 0, coverage_pct: null, circulated: 0, cost_eur_ht: 0, cost_eur_ht_at_full_occupancy: 0, by_brand: [] });
});

test('shapeCumul : prévus à 0 avec des lignes : couverture nulle sans division par zéro', () => {
  const c = shapeCumul([row('INOUI', 'planned', 0), row('INOUI', 'observed', 0)], prices);
  expect(c.coverage_pct).toBeNull();
});

test('shapeCumul : marque sans prix, valeur non numérique : erreur', () => {
  expect(() => shapeCumul([row('TER', 'planned', 1)], prices)).toThrow(/TER/);
  expect(() => shapeCumul([row('INOUI', 'planned', 'abc')], prices)).toThrow(/planned/);
});

const withRange: CumulRow[] = [
  ...rows,
  row('INOUI', 'comp_pct_sum_low', 100), row('INOUI', 'comp_pct_sum_high', 150), row('INOUI', 'aberrant', 2),
  row('OUIGO', 'comp_pct_sum_low', 50), row('OUIGO', 'comp_pct_sum_high', 100), row('OUIGO', 'aberrant', 1),
];

test('shapeCumul : fourchette par marque et au total, retards aberrants comptés', () => {
  const c = shapeCumul(withRange, prices);
  // INOUI : 46,6 × 556 = 25 909,6 par tranche de 100 % ; OUIGO : 34,2 × 634 = 21 682,8 ; × 0,75
  expect(c.cost_eur_ht_low).toBe(27563.25); // (100 % INOUI + 50 % OUIGO) × 0,75
  expect(c.cost_eur_ht_high).toBe(45410.4); // (150 % INOUI + 100 % OUIGO) × 0,75
  expect(c.cost_eur_ht).toBe(40552.35); // le central ne bouge pas
  expect(c.by_brand[0]).toMatchObject({ brand: 'INOUI', cost_eur_ht_low: 19432.2, cost_eur_ht_high: 29148.3, aberrant: 2 });
  expect(c.aberrant).toBe(3);
});

test('shapeCumul : sans mesures basse et haute (jours non recalculés), la fourchette vaut null et non 0', () => {
  const c = shapeCumul(rows, prices);
  expect(c.cost_eur_ht_low).toBeNull();
  expect(c.cost_eur_ht_high).toBeNull();
  expect(c.by_brand[0].cost_eur_ht_low).toBeNull();
});
