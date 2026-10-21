import type { Lngl } from './position';

export type TraceTable = { pairs: Record<string, [number, number][]> };

const r3 = (n: number) => n.toFixed(3);
const pt = (p: Lngl) => `${r3(p[0])},${r3(p[1])}`;

// Clé d'une paire d'arrêts : coordonnées à 3 décimales (celles de /api/live), extrémités triées.
export function pairKey(a: Lngl, b: Lngl): string {
  const [x, y] = [pt(a), pt(b)].sort();
  return `${x}|${y}`;
}

// Tracé précalculé si la paire est connue (inversé au besoin), sinon ligne droite.
export function makeSegment(table: TraceTable): (a: Lngl, b: Lngl) => Lngl[] {
  return (a, b) => {
    const line = table.pairs[pairKey(a, b)];
    if (!line) return [a, b];
    return pt(line[0]) === pt(a) ? line : [...line].reverse();
  };
}
