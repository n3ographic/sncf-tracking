'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SAMPLE_MIN, TERMINUS_BUCKETS, bucketShares, isSmallSample, monthOptions, sortGroups, suppressionPct,
} from '../../lib/dashboard-model';
import type { Group, StatsPayload, Totals } from '../../lib/stats';
import CumulBanner from './cumul-banner';

const FIXED = [['7d', '7 derniers jours'], ['14d', '14 derniers jours'], ['31d', '31 derniers jours']] as const;
const DASH = '—';
const occ = (n: number) => n.toLocaleString('fr-FR');

const pct = (n: number | null) => (n === null ? DASH : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} € HT`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const query = (p: string) => (/^\d+d$/.test(p) ? `period=${p}` : `month=${p}`);

function Bar({ buckets }: { buckets: Record<string, number> }) {
  const shares = bucketShares(buckets);
  const label = shares.filter((s) => s.n > 0).map((s) => `${s.bucket} min : ${pct(s.pct)}`).join(', ') || 'aucun train';
  return (
    <div className="bar" role="img" aria-label={`Retard au terminus : ${label}`} title={label}>
      {shares.map((s, i) => s.pct > 0 && <span key={s.bucket} className={`seg s${i}`} style={{ width: `${s.pct}%` }} />)}
    </div>
  );
}

function Kpi({ label, value, small }: { label: string; value: string; small: boolean }) {
  return (
    <div className={small ? 'kpi small' : 'kpi'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function TableauView() {
  const [period, setPeriod] = useState('7d');
  const [data, setData] = useState<StatsPayload | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const months = useMemo(() => monthOptions(new Date()), []);

  const load = useCallback(async (p: string) => {
    const mine = ++seq.current; // une réponse d'une période devenue obsolète est ignorée
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(`/api/stats?${query(p)}`);
      const d = (await r.json()) as StatsPayload;
      if (!r.ok || !Array.isArray(d.groups) || !d.totals) throw new Error(String(r.status));
      if (mine === seq.current) setData(d);
    } catch {
      if (mine === seq.current) setError(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const groups = useMemo(() => (data ? sortGroups(data.groups) : []), [data]);
  const t: Totals | undefined = data?.totals;

  return (
    <>
      <h1 className="term-h1">Tableau de bord</h1>

      <CumulBanner />

      <label className="tb-period">Période
        <select autoComplete="off" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {FIXED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </label>
      {data && !error && <p className="tb-range">Du {day(data.from)} au {day(data.to)}.</p>}

      <p className="tb-warn" role="note">
        La collecte a commencé le 20 octobre 2026. La régularité est une approximation de la régularité officielle :
        les retards du flux vont par pas de 5 minutes, « à l’heure » équivaut à un retard publié de 0.
        Les chiffres reposant sur moins de {SAMPLE_MIN} trains ayant circulé sont estompés : ils ne permettent pas de conclure.
      </p>

      {error && (
        <p className="tb-error" role="alert">
          Les statistiques sont indisponibles. <button type="button" onClick={() => load(period)}>Réessayer</button>
        </p>
      )}
      {loading && !error && <p className="tb-loading" role="status">Chargement…</p>}

      {data && t && !error && (
        <div className={loading ? 'tb-body stale' : 'tb-body'}>
          <dl className="kpis">
            <Kpi label="Trains ayant circulé" value={t.circulated.toLocaleString('fr-FR')} small={isSmallSample(t)} />
            <Kpi label="Régularité officielle (approchée)" value={pct(t.official_regularity_pct)} small={isSmallSample(t)} />
            <Kpi label="Taux de suppression" value={pct(suppressionPct(t))} small={isSmallSample(t)} />
            <Kpi label={`Indemnités théoriques (occupation ${occ(data.assumptions.occupancy)})`} value={eur(t.estimated_cost_eur_ht)} small={isSmallSample(t)} />
          </dl>

          {groups.length === 0 ? (
            <p className="tb-empty">Aucun train sur cette période.</p>
          ) : (
            <div className="tb-scroll">
              <table>
                <caption>Par marque et par axe</caption>
                <thead>
                  <tr>
                    <th scope="col">Marque</th><th scope="col">Axe</th><th scope="col">Trains ayant circulé</th>
                    <th scope="col">Régularité</th><th scope="col">Suppressions</th>
                    <th scope="col">Retard au terminus</th><th scope="col">Indemnités estimées</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g: Group) => (
                    <tr key={`${g.brand}|${g.axis}`} className={isSmallSample(g) ? 'small' : undefined}>
                      <th scope="row">{g.brand}</th>
                      <td>{g.axis}</td>
                      <td>{g.circulated}{isSmallSample(g) && <small> échantillon trop petit</small>}</td>
                      <td>{pct(g.official_regularity_pct)}</td>
                      <td>{pct(suppressionPct(g))}</td>
                      <td><Bar buckets={g.terminus_buckets} /></td>
                      <td>{eur(g.estimated_cost_eur_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ul className="legend" aria-label="Légende des tranches de retard au terminus">
            {TERMINUS_BUCKETS.map((b, i) => <li key={b}><span className={`seg s${i}`} /> {b} min</li>)}
          </ul>

          <p className="tb-foot">
            Prix de référence HT : {data.assumptions.prices.map((p) => `${p.brand} ${p.price_eur_ht.toLocaleString('fr-FR')} €`).join(', ')}
            {' '}(FNAUT d’après l’ART, 2023) ; occupation de référence {occ(data.assumptions.occupancy)}, hypothèse non sourcée.
            Observatoire indépendant, non affilié à SNCF ni à OUIGO.
          </p>
        </div>
      )}
    </>
  );
}
