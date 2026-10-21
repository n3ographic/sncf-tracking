import type { LiveTrain } from './live';
import { estimatePosition, type Lngl, type PositionState } from './position';

export type LiveItem = LiveTrain & { comp_eur_per_passenger_ref: number };
export type DelayClass = 'ontime' | 'late' | 'severe' | 'cancelled';
export type Filters = { brand: 'ALL' | 'INOUI' | 'OUIGO'; axis: string };

const LATE_S = 300;
const SEVERE_S = 1800;
const STALE_S = 600;

export function delayClass(t: Pick<LiveItem, 'cancelled' | 'delay_s'>): DelayClass {
  if (t.cancelled) return 'cancelled';
  const d = t.delay_s ?? 0;
  return d >= SEVERE_S ? 'severe' : d >= LATE_S ? 'late' : 'ontime';
}

export function applyFilters(trains: LiveItem[], f: Filters): LiveItem[] {
  return trains.filter((t) => (f.brand === 'ALL' || t.brand === f.brand) && (f.axis === 'ALL' || t.axis === f.axis));
}

export function axes(trains: LiveItem[]): string[] {
  return [...new Set(trains.map((t) => t.axis))].sort();
}

export function lateCount(trains: LiveItem[]): number {
  return trains.filter((t) => ['late', 'severe'].includes(delayClass(t))).length;
}

// Dernier passage du collecteur absent ou trop ancien : la position ne peut plus être garantie.
export function isStale(t: Pick<LiveItem, 'last_seen_at'>, now: Date): boolean {
  const seen = t.last_seen_at === undefined ? NaN : Date.parse(t.last_seen_at);
  return !Number.isFinite(seen) || now.getTime() - seen > STALE_S * 1000;
}

type Props = { trip_id: string; cls: DelayClass; stale: boolean; state: PositionState };

export type PointFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Props };
export type PointCollection = { type: 'FeatureCollection'; features: PointFeature[] };

export function toFeatureCollection(trains: LiveItem[], now: Date, path?: (a: Lngl, b: Lngl) => Lngl[]): PointCollection {
  const features: PointFeature[] = [];
  for (const t of trains) {
    const e = estimatePosition(t, now, path);
    if (!e) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { trip_id: t.trip_id, cls: delayClass(t), stale: isStale(t, now), state: e.state },
    });
  }
  return { type: 'FeatureCollection', features };
}
