import { expect, test } from 'vitest'
import { axisOf, brandOf, serviceDateOf } from '../supabase/functions/_shared/classify.ts'

test('brandOf : règles BRAND_RULES de la Task 1', () => {
  expect(brandOf('SNCF VOYAGEURS', '', 'OCESN5537F1187_F:OUI:FR:Line::19ea029b-…::87141002:87756056:18:2243:20261115')).toBe('INOUI')
  expect(brandOf('SNCF VOYAGEURS', '', 'OCESN7853F1187_F:OGO:FR:Line::D1E5AD07-…::87686006:87756056:7:2213:20261212')).toBe('OUIGO')
  // OUIGO Train Classique (40xx) exclu
  expect(brandOf('SNCF VOYAGEURS', '434A', 'OCESN4076F1187_F:OGO:FR:Line::X::87547000:87581009:5:1200:20261020')).toBeNull()
  expect(brandOf('SNCF VOYAGEURS', 'TER', 'OCESN860001F1187_F:TER:FR:Line::X::87000000:87000001:5:1200:20261020')).toBeNull()
  // numéro non extractible
  expect(brandOf('SNCF VOYAGEURS', '', 'XYZ:OGO:FR')).toBeNull()
})

test('axisOf', () => {
  expect(axisOf(['Lille Europe', 'Paris Nord'])).toBe('NORD')
  expect(axisOf(['Paris Gare de Lyon', 'Marseille St-Charles'])).toBe('SUD_EST')
  expect(axisOf(['Paris Bercy', 'Dijon'])).toBe('SUD_EST')
  expect(axisOf(['Paris Montparnasse', 'Bordeaux St-Jean'])).toBe('ATLANTIQUE')
  expect(axisOf(['Paris Est', 'Strasbourg'])).toBe('EST')
  expect(axisOf(['Lille Europe', 'Marne-la-Vallée Chessy', 'Lyon Part-Dieu'])).toBe('INTERSECTEURS')
})

test('axisOf : noms réels du GTFS', () => {
  expect(axisOf(['Lille Flandres', 'Paris Gare du Nord'])).toBe('NORD')
  expect(axisOf(['Paris Gare de Lyon Hall 1 - 2', 'Lyon Part-Dieu'])).toBe('SUD_EST')
  expect(axisOf(["Paris Bercy Bourg. Pays d'Auv.", 'Dijon'])).toBe('SUD_EST')
  expect(axisOf(['Paris Montparnasse Hall 1 - 2', 'Rennes'])).toBe('ATLANTIQUE')
  expect(axisOf(['Paris Montparnasse Vaugirard', 'Brest'])).toBe('ATLANTIQUE')
  expect(axisOf(['Strasbourg', 'Paris Est'])).toBe('EST')
  // première gare parisienne rencontrée
  expect(axisOf(['Paris Est', 'Paris Gare de Lyon Hall 1 - 2'])).toBe('EST')
})

test('serviceDateOf : vient du flux, pas de l’horloge (train à cheval sur minuit)', () => {
  expect(serviceDateOf('20261019')).toBe('2026-10-19')
  expect(() => serviceDateOf('2026-10-19')).toThrow()
})
