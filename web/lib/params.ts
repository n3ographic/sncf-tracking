export type StatsParams = { ok: true; from: string; to: string; occupancy: number } | { ok: false; error: string };

const MAX_DAYS = 31;
const DAY_MS = 86_400_000;
const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

// Date calendaire réelle (aller-retour : 2026-02-30 est refusée) → millisecondes UTC à minuit.
function parseDay(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s ? null : ms;
}
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function parseStatsParams(q: URLSearchParams, now: Date): StatsParams {
  const toRaw = q.get('to') ?? fmt(Date.parse(`${parisDate.format(now)}T00:00:00Z`) - DAY_MS);
  const to = parseDay(toRaw);
  if (to === null) return { ok: false, error: `date de fin invalide (AAAA-MM-JJ attendu) : ${toRaw}` };
  const fromRaw = q.get('from') ?? fmt(to - 6 * DAY_MS);
  const from = parseDay(fromRaw);
  if (from === null) return { ok: false, error: `date de début invalide (AAAA-MM-JJ attendu) : ${fromRaw}` };
  if (from > to) return { ok: false, error: 'la date de début doit précéder la date de fin' };
  if ((to - from) / DAY_MS + 1 > MAX_DAYS) return { ok: false, error: `période limitée à ${MAX_DAYS} jours inclus (dates comprises)` };

  const occRaw = q.get('occupancy');
  const occupancy = occRaw === null ? 0.75 : occRaw.trim() === '' ? NaN : Number(occRaw);
  if (!Number.isFinite(occupancy) || occupancy < 0 || occupancy > 1) {
    return { ok: false, error: 'occupation invalide : nombre entre 0 et 1 attendu' };
  }
  return { ok: true, from: fromRaw, to: toRaw, occupancy };
}
