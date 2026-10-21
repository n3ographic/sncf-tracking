import type { Lngl } from './position';

export type TraceTable = { pairs: Record<string, [number, number][]> };

const r3 = (n: number) => n.toFixed(3);
const pt = (p: Lngl) => `${r3(p[0])},${r3(p[1])}`;

// Clé d'une paire d'arrêts : coordonnées à 3 décimales (celles de /api/live), extrémités triées.
export function pairKey(a: Lngl, b: Lngl): string {
  const [x, y] = [pt(a), pt(b)].sort();
  return `${x}|${y}`;
}

const d2 = (p: Lngl, q: Lngl) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

// Tracé précalculé si la paire est connue, sinon ligne droite. Les extrémités du tracé sont des nœuds du
// réseau (jusqu'à 1 km des gares) : le sens se décide par proximité, et les gares ferment la polyligne.
export function makeSegment(table: TraceTable): (a: Lngl, b: Lngl) => Lngl[] {
  return (a, b) => {
    const line = table.pairs[pairKey(a, b)] as Lngl[] | undefined;
    if (!line) return [a, b];
    const first = line[0], last = line[line.length - 1];
    const forward = d2(first, a) + d2(last, b) <= d2(first, b) + d2(last, a);
    return [a, ...(forward ? line : [...line].reverse()), b];
  };
}

export type LineCollection = {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } }[];
};

// Les tracés précalculés, tels quels, pour les dessiner sur la carte (une ligne par paire d'arrêts).
export function tracesToLines(table: TraceTable): LineCollection {
  return {
    type: 'FeatureCollection',
    features: Object.values(table.pairs)
      .filter((line) => line.length >= 2)
      .map((coordinates) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } })),
  };
}
