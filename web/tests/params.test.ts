import { expect, test } from 'vitest';
import { parseStatsParams } from '../lib/params';

const now = new Date('2026-11-01T23:30:00Z'); // déjà le 2 novembre à Paris

test('valeurs par défaut : veille de Paris, 7 jours, occupation 0,75', () => {
  const r = parseStatsParams(new URLSearchParams(), now);
  expect(r).toEqual({ ok: true, from: '2026-10-26', to: '2026-11-01', occupancy: 0.75 });
});

test.each([
  ['from=2026-13-01&to=2026-11-01'], ['from=2026-11-05&to=2026-11-01'],
  ['from=2026-09-01&to=2026-11-01'], ['from=2016-01-01&to=2026-11-01'],
  ['occupancy=abc'], ['occupancy=5'], ['occupancy=-0.1'], ['from=2026-10-01&to=2026-11-01'] /* 32 jours */,
  ['from=2026-02-30&to=2026-03-01'], ['to=2026-11-1'], ['occupancy='], ['occupancy=Infinity'],
])('refuse %s', (qs) => expect(parseStatsParams(new URLSearchParams(qs), now).ok).toBe(false));

test('31 jours inclus acceptés', () => {
  expect(parseStatsParams(new URLSearchParams('from=2026-10-02&to=2026-11-01'), now))
    .toEqual({ ok: true, from: '2026-10-02', to: '2026-11-01', occupancy: 0.75 });
});

test('to seul : from = to − 6 jours, aujourd’hui accepté, occupation lue', () => {
  expect(parseStatsParams(new URLSearchParams('to=2026-11-02&occupancy=0.5'), now))
    .toEqual({ ok: true, from: '2026-10-27', to: '2026-11-02', occupancy: 0.5 });
});

test('les messages d’erreur sont en français', () => {
  const r = parseStatsParams(new URLSearchParams('from=2026-11-05&to=2026-11-01'), now);
  expect(r).toEqual({ ok: false, error: expect.stringContaining('date') });
});
