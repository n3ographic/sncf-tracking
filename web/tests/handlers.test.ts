import { beforeEach, expect, test, vi } from 'vitest';
import { createLiveHandler, createStatsHandler } from '../lib/handlers';
import { prices, scale } from './fixtures';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

const now = () => new Date('2026-10-21T10:00:00Z');
const okDeps = () => ({
  rpc: vi.fn(async (fn: string) => ({ data: fn === 'live_trains' ? [{ trip_id: 't', brand: 'INOUI', comp_pct: 50 }] : [{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: '3' }], error: null })),
  select: vi.fn(async (table: string) => ({ data: table === 'reference_prices' ? prices : scale, error: null })),
  now,
});

test('succès : 200, JSON et Cache-Control exact (stats et temps réel)', async () => {
  const deps = okDeps();
  const s = await createStatsHandler(deps)(new Request('http://x/api/stats?from=2026-10-01&to=2026-10-07'));
  expect(s.status).toBe(200);
  expect(s.headers.get('cache-control')).toBe('public, s-maxage=900, stale-while-revalidate=300');
  expect(s.headers.get('content-type')).toContain('application/json');
  expect((await s.json()).totals.planned).toBe(3);
  expect(deps.rpc).toHaveBeenCalledWith('stats_period', { p_from: '2026-10-01', p_to: '2026-10-07' });

  const l = await createLiveHandler(okDeps())(new Request('http://x/api/live'));
  expect(l.status).toBe(200);
  expect(l.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=30');
  const body = await l.json();
  expect(body.generated_at).toBe('2026-10-21T10:00:00.000Z');
  expect(body.trains[0].comp_eur_per_passenger_ref).toBe(23.3);
});

test('paramètres invalides : 400, no-store, la base n’est pas appelée', async () => {
  const deps = okDeps();
  const res = await createStatsHandler(deps)(new Request('http://x/api/stats?occupancy=5'));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(typeof (await res.json()).error).toBe('string');
  expect(deps.rpc).not.toHaveBeenCalled(); expect(deps.select).not.toHaveBeenCalled();
});

test('la base répond en erreur : 502, no-store, pas de corps trompeur', async () => {
  for (const make of [createStatsHandler, createLiveHandler]) {
    const deps = { ...okDeps(), select: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) };
    const res = await make(deps)(new Request('http://x/api/x'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['error']);
  }
});

test('la base lève une exception : 502, no-store', async () => {
  for (const make of [createStatsHandler, createLiveHandler]) {
    const deps = { ...okDeps(), rpc: vi.fn(async () => { throw new Error('réseau'); }) };
    const res = await make(deps)(new Request('http://x/api/x'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  }
});

test('nombre illisible venant de la base : 502 plutôt que NaN', async () => {
  const deps = { ...okDeps(), rpc: vi.fn(async () => ({ data: [{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: 'abc' }], error: null })) };
  const res = await createStatsHandler(deps)(new Request('http://x/api/stats'));
  expect(res.status).toBe(502);
});
