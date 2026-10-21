import { round, toNum } from './num';
import { DEFAULT_OCCUPANCY, type Price } from './stats';

export type CumulRow = { brand: string; metric: string; n: number | string; days: number; first_day: string; last_day: string };
export type CumulBrand = {
  brand: string; planned: number; observed: number; circulated: number; comp_eligible: number; comp_pct_sum: number;
  cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number;
};
export type Cumul = {
  since: string | null; through: string | null; days: number;
  planned: number; observed: number; coverage_pct: number | null; circulated: number; comp_eligible: number;
  cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number;
  by_brand: CumulBrand[];
  assumptions: { occupancy: number; prices: Price[] };
};

const COUNTS = ['planned', 'observed', 'circulated', 'comp_eligible', 'comp_pct_sum'] as const;

// Compteur observé seulement : jamais extrapolé aux trains non observés. Le coût se calcule à la lecture
// (prix, places et occupation sont des hypothèses) : pourcentage cumulé × prix HT × places × occupation.
export function shapeCumul(rows: CumulRow[], prices: Price[], occupancy = DEFAULT_OCCUPANCY): Cumul {
  const refs = prices.map((p) => ({ ...p, price_eur_ht: toNum(p.price_eur_ht, 'price_eur_ht'), seats: toNum(p.seats, 'seats') }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  const byBrand = new Map<string, Record<(typeof COUNTS)[number], number>>();
  for (const r of rows) {
    if (!(COUNTS as readonly string[]).includes(r.metric)) continue; // tranches de retard : sans objet ici
    const c = byBrand.get(r.brand) ?? { planned: 0, observed: 0, circulated: 0, comp_eligible: 0, comp_pct_sum: 0 };
    c[r.metric as (typeof COUNTS)[number]] += toNum(r.n, r.metric);
    byBrand.set(r.brand, c);
  }
  const brands = [...byBrand.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([brand, c]) => {
    const price = refs.find((p) => p.brand === brand);
    if (!price) throw new Error(`prix de référence absent pour ${brand}`);
    const full = (c.comp_pct_sum / 100) * price.price_eur_ht * price.seats;
    return { brand, ...c, full, cost: full * occupancy };
  });
  const sum = (f: (b: (typeof brands)[number]) => number) => brands.reduce((s, b) => s + f(b), 0);
  const planned = sum((b) => b.planned), observed = sum((b) => b.observed);
  return {
    since: rows[0]?.first_day ?? null,
    through: rows[0]?.last_day ?? null,
    days: rows[0]?.days ?? 0,
    planned, observed,
    coverage_pct: planned === 0 ? null : round((observed / planned) * 100, 1),
    circulated: sum((b) => b.circulated),
    comp_eligible: sum((b) => b.comp_eligible),
    cost_eur_ht: round(sum((b) => b.cost), 2),
    cost_eur_ht_at_full_occupancy: round(sum((b) => b.full), 2),
    by_brand: brands.map(({ full, cost, ...b }) => ({ ...b, cost_eur_ht: round(cost, 2), cost_eur_ht_at_full_occupancy: round(full, 2) })),
    assumptions: { occupancy, prices: refs },
  };
}
