import { expect, test } from 'vitest';
import { axisRegularity, charBar, collectStatus, delayTone, tickerItems, topDelays } from '../lib/terminal-model';
import type { LiveItem } from '../lib/map-model';
import type { Group } from '../lib/stats';

const NOW = new Date('2026-10-22T15:00:00Z');
const item = (over: Partial<LiveItem>): LiveItem => ({
  trip_id: over.train_number ?? 't', service_date: '2026-10-22', brand: 'INOUI', axis: 'SUD_EST', train_number: '1', cancelled: false,
  dep_planned: '2026-10-22T13:00:00Z', arr_planned: '2026-10-22T17:00:00Z', comp_pct: 0, comp_eur_per_passenger_ref: 0,
  last_seen_at: '2026-10-22T14:58:00Z', stops: [], ...over,
});

test('delayTone : seuils 5, 30 et 60 min, annulé prioritaire', () => {
  const t = (d?: number, c = false) => delayTone(d, c);
  expect([t(299), t(300), t(1799), t(1800), t(3599), t(3600), t(undefined)]).toEqual(['ontime', 'late', 'late', 'strong', 'strong', 'severe', 'ontime']);
  expect(t(9000, true)).toBe('cancelled');
});

test('topDelays : sans annulés ni retards nuls, tri décroissant, coupe à n', () => {
  const l = [
    item({ train_number: 'a', delay_s: 6000 }), item({ train_number: 'b', delay_s: 13800 }), item({ train_number: 'c', delay_s: 10200 }),
    item({ train_number: 'x', delay_s: 20000, cancelled: true }), item({ train_number: 'z', delay_s: 0 }), item({ train_number: 'n' }),
  ];
  expect(topDelays(l, 10).map((t) => t.train_number)).toEqual(['b', 'c', 'a']);
  expect(topDelays(l, 2).map((t) => t.train_number)).toEqual(['b', 'c']);
  expect(topDelays([], 10)).toEqual([]);
});

test('tickerItems : libellé, minutes arrondies, destination absente omise', () => {
  const [a, b] = tickerItems([
    item({ trip_id: 'T1', train_number: '9713', origin: 'Paris', dest: 'Barcelone', delay_s: 13800 }),
    item({ trip_id: 'T2', brand: 'OUIGO', train_number: '7825', origin: 'Paris', delay_s: 10230 }),
  ], 5);
  expect(a).toEqual({ trip_id: 'T1', label: 'INOUI 9713 Paris → Barcelone', minutes: 230, tone: 'severe' });
  expect(b.label).toBe('OUIGO 7825 Paris');
  expect(b.minutes).toBe(171);
});

test('collectStatus : moins de 10 minutes OK, au-delà en retard, rien : inconnu', () => {
  expect(collectStatus([item({ last_seen_at: '2026-10-22T14:51:00Z' }), item({ last_seen_at: '2026-10-22T14:40:00Z' })], NOW)).toEqual({ status: 'ok', ageMin: 9 });
  expect(collectStatus([item({ last_seen_at: '2026-10-22T14:49:00Z' })], NOW)).toEqual({ status: 'late', ageMin: 11 });
  expect(collectStatus([], NOW)).toEqual({ status: 'unknown', ageMin: null });
});

test('axisRegularity : somme des marques par axe, pourcentage, petit échantillon', () => {
  const g = (brand: string, axis: string, circulated: number, on_time_official: number) => ({ brand, axis, circulated, on_time_official }) as Group;
  const r = axisRegularity([g('OUIGO', 'ATLANTIQUE', 4, 3), g('INOUI', 'ATLANTIQUE', 19, 14), g('INOUI', 'EST', 0, 0), g('INOUI', 'SUD_EST', 40, 20)]);
  expect(r.map((x) => x.axis)).toEqual(['ATLANTIQUE', 'EST', 'SUD_EST']);
  expect(r[0]).toEqual({ axis: 'ATLANTIQUE', circulated: 23, on_time: 17, pct: 73.9, small: true });
  expect(r[1]).toMatchObject({ pct: null, small: true });
  expect(r[2]).toMatchObject({ pct: 50, small: false });
});

test('charBar : pleins et demi-cellule, vide à 0 ou null', () => {
  expect(charBar(100, 10)).toBe('█'.repeat(10));
  expect(charBar(50, 10)).toBe('█'.repeat(5));
  expect(charBar(55, 10)).toBe('█'.repeat(5) + '▌');
  expect(charBar(0, 10)).toBe('');
  expect(charBar(null, 10)).toBe('');
});
