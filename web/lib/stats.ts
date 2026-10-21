import { round, toNum } from './num';

export type StatRow = { brand: string; axis: string; metric: string; n: number };
export type Price = { brand: string; price_eur_ht: number; seats: number; price_source: string; seats_source: string; as_of: string };
export type Scale = { brand: string; from_s: number; pct: number; source_url: string; source_as_of: string };

const COUNTS = ['planned', 'observed', 'removed_late', 'never_observed', 'cancelled', 'no_terminus',
  'circulated', 'on_time_official', 'comp_eligible', 'comp_pct_sum'] as const;
const BUCKETS = ['0', '1-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+'];
const STOP_BUCKETS = [...BUCKETS, 'cancelled'];

type Counts = Record<(typeof COUNTS)[number], number>;
export type Totals = Counts & {
  official_regularity_pct: number | null;
  terminus_buckets: Record<string, number>;
  stop_buckets: Record<string, number>;
  estimated_cost_eur_ht: number;
};
export type Group = { brand: string; axis: string } & Totals;
export type StatsPayload = {
  from: string; to: string; groups: Group[]; totals: Totals;
  assumptions: { occupancy: number; prices: Price[]; compensation_scale: Scale[] };
};

const zeros = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
const empty = (): Totals => ({
  ...(zeros(COUNTS) as Counts), official_regularity_pct: null,
  terminus_buckets: zeros(BUCKETS), stop_buckets: zeros(STOP_BUCKETS), estimated_cost_eur_ht: 0,
});
const regularity = (t: Totals) => (t.circulated === 0 ? null : round((t.on_time_official / t.circulated) * 100, 1));

export function shapeStats(rows: StatRow[], prices: Price[], scale: Scale[], p: { from: string; to: string; occupancy: number }): StatsPayload {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const n = toNum(row.n, row.metric);
    const key = `${row.brand}|${row.axis}`;
    const g = groups.get(key) ?? { brand: row.brand, axis: row.axis, ...empty() };
    groups.set(key, g);
    const [kind, bucket] = row.metric.split(':');
    if (bucket !== undefined) {
      const target = kind === 'terminus' ? g.terminus_buckets : kind === 'stop' ? g.stop_buckets : undefined;
      if (target && bucket in target) target[bucket] += n;
    } else if ((COUNTS as readonly string[]).includes(row.metric)) {
      g[row.metric as keyof Counts] += n;
    } // métrique inconnue : ignorée
  }

  const totals = empty();
  let cost = 0;
  const list = [...groups.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.axis.localeCompare(b.axis));
  for (const g of list) {
    const price = prices.find((x) => x.brand === g.brand);
    if (!price) throw new Error(`prix de référence absent pour ${g.brand}`);
    const raw = (g.comp_pct_sum / 100) * toNum(price.price_eur_ht, 'price_eur_ht') * toNum(price.seats, 'seats') * p.occupancy;
    cost += raw;
    g.estimated_cost_eur_ht = round(raw, 2);
    g.official_regularity_pct = regularity(g);
    for (const k of COUNTS) totals[k] += g[k];
    for (const k of BUCKETS) totals.terminus_buckets[k] += g.terminus_buckets[k];
    for (const k of STOP_BUCKETS) totals.stop_buckets[k] += g.stop_buckets[k];
  }
  totals.estimated_cost_eur_ht = round(cost, 2);
  totals.official_regularity_pct = regularity(totals);

  return {
    from: p.from, to: p.to, groups: list, totals,
    assumptions: {
      occupancy: p.occupancy,
      prices: [...prices].sort((a, b) => a.brand.localeCompare(b.brand)),
      compensation_scale: [...scale].sort((a, b) => a.brand.localeCompare(b.brand) || toNum(a.from_s, 'from_s') - toNum(b.from_s, 'from_s')),
    },
  };
}
