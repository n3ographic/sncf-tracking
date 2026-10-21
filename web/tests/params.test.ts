import { expect, test } from 'vitest';
import { parseStatsParams } from '../lib/params';

const now = new Date('2026-11-01T23:30:00Z'); // déjà le 2 novembre à Paris
const parse = (qs: string, at = now) => parseStatsParams(new URLSearchParams(qs), at);

test('sans paramètre : 7 jours jusqu’à la veille de Paris', () => {
  expect(parse('')).toEqual({ ok: true, from: '2026-10-26', to: '2026-11-01' });
});

test('period=7d à 23 h 30 UTC le 1er novembre (déjà le 2 à Paris)', () => {
  expect(parse('period=7d')).toEqual({ ok: true, from: '2026-10-26', to: '2026-11-01' });
});

test('period=14d et 31d', () => {
  expect(parse('period=14d')).toEqual({ ok: true, from: '2026-10-19', to: '2026-11-01' });
  expect(parse('period=31d')).toEqual({ ok: true, from: '2026-10-02', to: '2026-11-01' });
});

test('month=2026-10 en cours de mois : jusqu’à aujourd’hui (Paris)', () => {
  expect(parse('month=2026-10', new Date('2026-10-15T22:30:00Z'))).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-16' });
});

test('month=2026-10 après le mois : jusqu’au 31', () => {
  expect(parse('month=2026-10')).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-31' });
});

test('month=2026-11 (mois courant à Paris) accepté', () => {
  expect(parse('month=2026-11')).toEqual({ ok: true, from: '2026-11-01', to: '2026-11-02' });
});

test.each([
  'foo=1', 'occupancy=0.5', 'from=2026-10-20&to=2026-10-21', 'to=2026-10-21',
  'period=8d', 'period=7D', 'period=', 'period=7d&month=2026-10', 'period=7d&period=14d', 'period=7d&x=1',
  'month=2026-09', 'month=2099-01', 'month=2026-12', 'month=2026-13', 'month=2026-1', 'month=2026-10-01',
])('refuse %s', (qs) => expect(parse(qs).ok).toBe(false));

test('aucun message d’erreur ne reprend la valeur fournie', () => {
  for (const qs of ['period=<script>', 'month=<script>', '<script>=1', 'period=7d&<script>=1']) {
    const r = parse(qs);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).not.toContain('<script>'); expect(r.error).not.toContain('script'); }
  }
});
