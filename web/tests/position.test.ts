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
