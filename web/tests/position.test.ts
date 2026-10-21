import { expect, test } from 'vitest';
import { estimatePosition, type Lngl } from '../lib/position';
import type { LiveStop } from '../lib/live';

const A: LiveStop = { seq: 1, lon: 2, lat: 48, dep: '2026-11-02T11:00:00Z' };
const B: LiveStop = { seq: 2, lon: 4, lat: 46, arr: '2026-11-02T12:00:00Z' };
const train = (stops: LiveStop[], delay_s?: number, cancelled = false) => ({ stops, delay_s, cancelled });
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

test('avant le départ : à l’arrêt A', () => {
  expect(estimatePosition(train([A, B], 0), at('10:50'))).toEqual({ lon: 2, lat: 48, state: 'at_stop' });
});

test('en route, retard nul : milieu du segment', () => {
  const e = estimatePosition(train([A, B], 0), at('11:30'))!;
  expect(e.state).toBe('moving');
  expect(e.lon).toBeCloseTo(3);
  expect(e.lat).toBeCloseTo(47);
});

test('après l’arrivée : arrêt B', () => {
  expect(estimatePosition(train([A, B], 0), at('12:10'))).toEqual({ lon: 4, lat: 46, state: 'arrived' });
});

test('retard de 600 s : départ et arrivée décalés', () => {
  expect(estimatePosition(train([A, B], 600), at('11:05'))!.state).toBe('at_stop');
  const e = estimatePosition(train([A, B], 600), at('11:40'))!; // (11:40−11:10)/(12:10−11:10) = 0,5
  expect(e.state).toBe('moving');
  expect(e.lon).toBeCloseTo(3);
});

test('retard négatif traité comme nul', () => {
  const e = estimatePosition(train([A, B], -120), at('11:30'))!;
  expect(e.lon).toBeCloseTo(3);
  expect(e.lat).toBeCloseTo(47);
});

test('un seul arrêt : à l’arrêt ; aucun arrêt : null', () => {
  expect(estimatePosition(train([A], 0), at('11:30'))).toEqual({ lon: 2, lat: 48, state: 'at_stop' });
  expect(estimatePosition(train([], 0), at('11:30'))).toBeNull();
});

test('annulé : à l’arrêt A quelle que soit l’heure', () => {
  expect(estimatePosition(train([A, B], undefined, true), at('11:30'))).toEqual({ lon: 2, lat: 48, state: 'at_stop' });
});

test('coordonnée ou horaire invalide : null', () => {
  expect(estimatePosition(train([{ ...A, lat: undefined }, B], 0), at('11:30'))).toBeNull();
  expect(estimatePosition(train([{ ...A, dep: 'pas une date' }, B], 0), at('11:30'))).toBeNull();
});

test('départ corrigé ≥ arrivée corrigée : arrêt B, sans division par zéro', () => {
  const e = estimatePosition(train([{ ...A, dep: '2026-11-02T12:00:00Z' }, B], 0), at('12:00'))!;
  expect(e).toEqual({ lon: 4, lat: 46, state: 'arrived' });
});

test('le tracé injecté est suivi au prorata de sa longueur', () => {
  // Polyligne le long d'un méridien (deux côtés égaux) : le milieu du trajet est le sommet intermédiaire.
  const path = (a: Lngl, b: Lngl): Lngl[] => [a, [a[0], 47], [a[0], b[1]]];
  const e = estimatePosition(train([A, { ...B, lon: 2 }], 0), at('11:30'), path)!;
  expect(e.lon).toBeCloseTo(2);
  expect(e.lat).toBeCloseTo(47);
});

test('progression le long d’une polyligne pondérée par la latitude', () => {
  // À 60° N un degré de longitude vaut la moitié d'un degré de latitude : le coude est atteint au tiers du trajet.
  const L: LiveStop[] = [{ seq: 1, lon: 0, lat: 60, dep: '2026-11-02T11:00:00Z' }, { seq: 2, lon: 1, lat: 61, arr: '2026-11-02T12:00:00Z' }];
  const path = (): Lngl[] => [[0, 60], [1, 60], [1, 61]];
  const e = estimatePosition(train(L, 0), at('11:20'), path)!;
  expect(e.lon).toBeCloseTo(1, 1);
  expect(e.lat).toBeCloseTo(60, 1);
});

// Fenêtre de trois arrêts, retard par arrêt : le tronçon actif est celui qui encadre l'heure.
const C: LiveStop = { seq: 3, lon: 6, lat: 44, arr: '2026-11-02T13:00:00Z', dep: '2026-11-02T13:05:00Z' };
const M: LiveStop = { seq: 2, lon: 4, lat: 46, arr: '2026-11-02T12:00:00Z', dep: '2026-11-02T12:10:00Z' };
const trip3 = (delay?: number) => train([{ ...A, delay_s: delay }, { ...M, delay_s: delay }, { ...C, delay_s: delay }], delay);

test('trois arrêts : au premier tronçon, puis à l’arrêt intermédiaire (temps d’arrêt), puis au second tronçon', () => {
  const first = estimatePosition(trip3(0), at('11:30'))!;
  expect(first.state).toBe('moving');
  expect(first.lon).toBeCloseTo(3);
  expect(estimatePosition(trip3(0), at('12:05'))).toEqual({ lon: 4, lat: 46, state: 'at_stop' }) // entre l'arrivée (12:00) et le départ (12:10)
  const second = estimatePosition(trip3(0), at('12:35'))!; // (12:35−12:10)/(13:00−12:10) = 0,5
  expect(second.state).toBe('moving');
  expect(second.lon).toBeCloseTo(5);
  expect(second.lat).toBeCloseTo(45);
  expect(estimatePosition(trip3(0), at('13:10'))).toEqual({ lon: 6, lat: 44, state: 'arrived' })
});

test('trois arrêts : le retard d’un arrêt décale ses horaires, un arrêt sans retard reprend celui du précédent', () => {
  const stops: LiveStop[] = [{ ...A, delay_s: 600 }, { ...M }, { ...C }]; // M et C reprennent 600 s
  const e = estimatePosition(train(stops), at('12:30'))!; // M repart à 12:20, C arrive à 13:10 : (12:30−12:20)/50 min = 0,2
  expect(e.state).toBe('moving');
  expect(e.lon).toBeCloseTo(4 + 2 * 0.2);
});

test('fenêtre qui commence en cours de trajet : le premier arrêt est l’arrêt déjà quitté', () => {
  const stops: LiveStop[] = [{ ...M, delay_s: 0 }, { ...C, delay_s: 0 }]; // départ de M à 12:10
  expect(estimatePosition(train(stops), at('12:10'))).toMatchObject({ state: 'moving', lon: 4, lat: 46 });
  expect(estimatePosition(train(stops), at('12:00'))).toEqual({ lon: 4, lat: 46, state: 'at_stop' });
});
