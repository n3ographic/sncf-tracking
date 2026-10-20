import { expect, test } from 'vitest'
import { toCsv } from '../supabase/functions/_shared/csv.ts'
import { monthRangeParis, previousMonthParis } from '../supabase/functions/_shared/month.ts'

test('toCsv : échappement RFC 4180', () => {
  expect(toCsv([{ a: 'a,"b"' }], ['a'])).toBe('a\n"a,""b"""\n')
  expect(toCsv([{ a: 'x\ny', b: 'ok' }], ['a', 'b'])).toBe('a,b\n"x\ny",ok\n')
})

test('toCsv : value en JSON, null vide', () => {
  expect(toCsv([{ id: 1, value: { delay_s: 120, note: 'a,b' }, stop_sequence: null }], ['id', 'stop_sequence', 'value']))
    .toBe('id,stop_sequence,value\n1,,"{""delay_s"":120,""note"":""a,b""}"\n')
})

test("toCsv : l'en-tête suit l'ordre de columns", () => {
  expect(toCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a'])).toBe('c,a\n3,1\n')
  expect(toCsv([], ['x', 'y'])).toBe('x,y\n')
})

test('monthRangeParis : bornes du mois à Paris, changement d’heure compris', () => {
  expect(monthRangeParis('2026-10')).toEqual(['2026-10-01T00:00:00+02:00', '2026-11-01T00:00:00+01:00'])
  expect(monthRangeParis('2026-12')).toEqual(['2026-12-01T00:00:00+01:00', '2027-01-01T00:00:00+01:00'])
  expect(monthRangeParis('2027-03')).toEqual(['2027-03-01T00:00:00+01:00', '2027-04-01T00:00:00+02:00'])
  expect(() => monthRangeParis('2026-13')).toThrow()
  expect(() => monthRangeParis('2026-1')).toThrow()
})

test('previousMonthParis : mois précédent à Paris', () => {
  expect(previousMonthParis(new Date('2026-11-01T04:00:00Z'))).toBe('2026-10')
  // 23:30 UTC le 31 octobre = 00:30 le 1er novembre à Paris
  expect(previousMonthParis(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10')
  expect(previousMonthParis(new Date('2027-01-01T04:00:00Z'))).toBe('2026-12')
})
