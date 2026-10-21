import type { LiveTrain } from './live';

export type Lngl = [number, number];
export type PositionState = 'at_stop' | 'moving' | 'arrived';
export type Estimate = { lon: number; lat: number; state: PositionState };

// Tracé entre deux arrêts : droit pour l'instant ; le plan 3b le remplacera par les tracés SNCF Réseau.
export function segment(a: Lngl, b: Lngl): Lngl[] {
  return [a, b];
}

// Point à la fraction p (0..1) de la longueur de la polyligne.
function along(line: Lngl[], p: number): Lngl {
  // Longitude pondérée par cos(latitude) : un degré de longitude est plus court qu'un degré de latitude.
  const lens = line.slice(1).map((pt, i) => {
    const k = Math.cos((((pt[1] + line[i][1]) / 2) * Math.PI) / 180);
    return Math.hypot((pt[0] - line[i][0]) * k, pt[1] - line[i][1]);
  });
  let left = lens.reduce((s, l) => s + l, 0) * p;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : Math.min(left / lens[i], 1);
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
    }
    left -= lens[i];
  }
  return line[0];
}

const ms = (iso?: string) => (iso === undefined ? NaN : Date.parse(iso));

// Position estimée entre le dernier arrêt portant un retard (A) et le suivant (B), à retard constant.
export function estimatePosition(
  train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>,
  now: Date,
  path: (a: Lngl, b: Lngl) => Lngl[] = segment,
): Estimate | null {
  const [a, b] = train.stops;
  if (!a || a.lon == null || a.lat == null || !Number.isFinite(a.lon + a.lat)) return null;
  const at_a: Estimate = { lon: a.lon, lat: a.lat, state: 'at_stop' };
  if (train.cancelled || !b) return at_a;
  if (b.lon == null || b.lat == null || !Number.isFinite(b.lon + b.lat)) return null;

  const delay = Math.max(train.delay_s ?? 0, 0) * 1000;
  const dep = (Number.isFinite(ms(a.dep)) ? ms(a.dep) : ms(a.arr)) + delay;
  const arr = (Number.isFinite(ms(b.arr)) ? ms(b.arr) : ms(b.dep)) + delay;
  if (!Number.isFinite(dep) || !Number.isFinite(arr)) return null;

  const t = now.getTime();
  if (t < dep) return at_a;
  if (t >= arr || dep >= arr) return { lon: b.lon, lat: b.lat, state: 'arrived' };
  const [lon, lat] = along(path([a.lon, a.lat], [b.lon, b.lat]), (t - dep) / (arr - dep));
  return { lon, lat, state: 'moving' };
}
