import { shapeLive, type LiveTrain } from './live';
import { parseStatsParams } from './params';
import { shapeStats, type Price, type Scale, type StatRow } from './stats';

type Result = Promise<{ data: unknown; error: unknown }>;
export type Deps = {
  rpc: (fn: string, args: Record<string, unknown>) => Result;
  select: (table: string, columns: string) => Result;
  now: () => Date;
};

const STATS_CACHE = 'public, s-maxage=900, stale-while-revalidate=300';
const LIVE_CACHE = 'public, s-maxage=60, stale-while-revalidate=30';

const json = (body: unknown, status: number, cache: string) =>
  Response.json(body, { status, headers: { 'Cache-Control': cache } });

async function unwrap<T>(r: Result, what: string): Promise<T> {
  const { data, error } = await r;
  if (error || !Array.isArray(data)) throw new Error(`lecture de ${what} impossible`);
  return data as T;
}

// Toute erreur côté base (réponse en erreur, exception, nombre illisible) : 502 jamais mis en cache.
async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(e);
    return json({ error: 'données momentanément indisponibles' }, 502, 'no-store');
  }
}

export function createStatsHandler(deps: Deps) {
  return async (req: Request) => {
    const p = parseStatsParams(new URL(req.url).searchParams, deps.now());
    if (!p.ok) return json({ error: p.error }, 400, 'no-store');
    return guarded(async () => {
      const [rows, prices, scale] = await Promise.all([
        unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: p.from, p_to: p.to }), 'stats_period'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        unwrap<Scale[]>(deps.select('compensation_scale', 'brand,from_s,pct,source_url,source_as_of'), 'compensation_scale'),
      ]);
      return json(shapeStats(rows, prices, scale, p), 200, STATS_CACHE);
    });
  };
}

export function createLiveHandler(deps: Deps) {
  return async (_req: Request) => guarded(async () => {
    const [trains, prices] = await Promise.all([
      unwrap<LiveTrain[]>(deps.rpc('live_trains', {}), 'live_trains'),
      unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
    ]);
    return json(shapeLive(trains, prices, deps.now()), 200, LIVE_CACHE);
  });
}
