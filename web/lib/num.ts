// PostgREST renvoie bigint/numeric en nombre ou en chaîne : on convertit et on refuse tout non-fini.
export function toNum(v: unknown, what: string): number {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new Error(`valeur non numérique pour ${what}`);
  return n;
}

export const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
