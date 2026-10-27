import { expect, test } from 'vitest';
import { searchTrains } from '../lib/train-search';
import type { LiveItem } from '../lib/map-model';

const item = (over: Partial<LiveItem>): LiveItem => ({
  trip_id: over.train_number ?? 't', service_date: '2026-11-02', brand: 'INOUI', axis: 'SUD_EST', train_number: '1', cancelled: false,
  dep_planned: '2026-11-02T11:00:00Z', arr_planned: '2026-11-02T12:00:00Z', comp_pct: 0, comp_eur_per_passenger_ref: 0, stops: [], ...over,
});
const trains = [
  item({ train_number: '7845', brand: 'OUIGO', origin: 'Lille Flandres', dest: 'Marseille Saint-Charles' }),
  item({ train_number: '78', origin: 'Paris Gare de Lyon Hall 1 - 2', dest: 'Besançon Viotte' }),
  item({ train_number: '7850', origin: 'Paris Montparnasse Hall 1 - 2', dest: 'Bordeaux Saint-Jean', cancelled: true }),
  item({ train_number: '9254', origin: 'Strasbourg', dest: 'Paris Est' }),
  item({ train_number: '12374' }), // sans origine ni destination connues
];
const nums = (q: string, limit?: number) => searchTrains(trains, q, limit).map((t) => t.train_number);

test('numéro exact d’abord, puis numéros commençant par la saisie', () => {
  expect(nums('78')).toEqual(['78', '7845', '7850']);
  expect(nums('7845')).toEqual(['7845']);
});

test('un numéro ne trouve pas un train dont le numéro le contient seulement au milieu', () => {
  expect(nums('45')).toEqual([]);
});

test('gare d’origine ou de destination, sans tenir compte des accents ni de la casse', () => {
  expect(nums('besancon')).toEqual(['78']);
  expect(nums('BESANÇON viotte')).toEqual(['78']);
  expect(nums('montparnasse')).toEqual(['7850']);
  expect(nums('gare de lyon')).toEqual(['78']);
  expect(nums('paris')).toEqual(['78', '7850', '9254']);
});

test('marque et numéro ensemble : tous les mots doivent correspondre', () => {
  expect(nums('ouigo 7845')).toEqual(['7845']);
  expect(nums('ouigo 78')).toEqual(['7845']);
  expect(nums('inoui 7845')).toEqual([]);
  expect(nums('ouigo lille')).toEqual(['7845']);
});

test('trains supprimés trouvables ; train sans gare connue trouvé par son numéro', () => {
  expect(nums('7850')).toEqual(['7850']);
  expect(nums('12374')).toEqual(['12374']);
});

test('saisie vide, espaces ou une seule lettre : aucun résultat ; aucun train correspondant : liste vide', () => {
  expect([nums(''), nums('   '), nums('p'), nums('zzz')]).toEqual([[], [], [], []]);
});

test('limite le nombre de résultats', () => {
  expect(nums('paris', 2)).toEqual(['78', '7850']);
  expect(searchTrains([], '78')).toEqual([]);
});
