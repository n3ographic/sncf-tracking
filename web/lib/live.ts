import { round, toNum } from './num';
import type { Price } from './stats';

type Place = { stop_id: string; name: string | null };
export type LiveStop = {
  seq: number; stop_id: string; name: string | null; lat: number | null; lon: number | null;
  arr: string | null; dep: string | null; delay_s: number | null; cancelled: boolean;
};
// Clés produites par public.live_trains().
export type LiveTrain = {
  trip_id: string; service_date: string; brand: string; axis: string; train_number: string;
  cancelled: boolean; dep_planned: string; arr_planned: string; origin: Place; dest: Place;
  delay_s: number | null; last_seq: number | null; cause: string | null; comp_pct: number;
  last_seen_at: string | null; stops: LiveStop[];
};

export function shapeLive(trains: LiveTrain[], prices: Price[], now: Date) {
  return {
    generated_at: now.toISOString(),
    trains: trains.map((t) => {
      const price = prices.find((x) => x.brand === t.brand);
      if (!price) throw new Error(`prix de référence absent pour ${t.brand}`);
      const comp = (toNum(t.comp_pct, 'comp_pct') / 100) * toNum(price.price_eur_ht, 'price_eur_ht');
      return { ...t, comp_eur_per_passenger_ref: round(comp, 2) };
    }),
  };
}
