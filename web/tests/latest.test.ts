import { expect, test } from 'vitest';
import { latest } from '../lib/latest';

test('latest : seule la dernière requête lancée est à jour, quel que soit l’ordre d’arrivée', () => {
  const start = latest();
  const first = start();
  expect(first()).toBe(true);
  const second = start();
  expect(first()).toBe(false); // réponse de la période précédente arrivée trop tard : ignorée
  expect(second()).toBe(true);
  const third = start();
  expect([first(), second(), third()]).toEqual([false, false, true]);
});
