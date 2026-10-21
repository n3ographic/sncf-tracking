import { expect, test } from 'vitest';
import { shapeLive, type LiveTrain } from '../lib/live';
import { prices } from './fixtures';

const train = (brand: string, comp_pct: number) => ({ trip_id: 't', brand, comp_pct, stops: [] }) as unknown as LiveTrain;

test('indemnité de référence par voyageur', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const p = shapeLive([train('INOUI', 50), train('INOUI', 0), train('OUIGO', 25)], prices, now);
  expect(p.generated_at).toBe('2026-10-21T10:00:00.000Z');
  expect(p.trains.map((t) => t.comp_eur_per_passenger_ref)).toEqual([23.3, 0, 8.55]);
  expect(p.trains[0].trip_id).toBe('t');
});

test('marque sans prix : erreur plutôt que NaN', () => {
  expect(() => shapeLive([train('TER', 25)], prices, new Date())).toThrow();
});
