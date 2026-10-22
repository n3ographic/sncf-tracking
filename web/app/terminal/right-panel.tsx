import { isSmallSample, suppressionPct } from '../../lib/dashboard-model';
import type { Cumul } from '../../lib/cumul';
import type { StatsPayload } from '../../lib/stats';
import { axisRegularity, charBar, periodLabel, type Period } from '../../lib/terminal-model';

const nf = (n: number) => n.toLocaleString('fr-FR');
const AXIS_SHORT: Record<string, string> = { ATLANTIQUE: 'ATL', EST: 'EST', INTERSECTEURS: 'INTER', NORD: 'NORD', SUD_EST: 'S-EST' };
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const tone = (p: number | null) => (p === null ? 'term-dim' : p >= 80 ? 'tone-ontime' : p >= 60 ? 'tone-late' : p >= 40 ? 'tone-strong' : 'tone-severe');

export default function RightPanel({ cumul, cumulFailed, stats, statsFailed, statsLoading, period }: {
  cumul: Cumul | null; cumulFailed: boolean; stats: StatsPayload | null; statsFailed: boolean; statsLoading: boolean; period: Period;
}) {
  const t = stats?.totals;
  const stale = statsLoading && stats && !statsFailed ? ' term-stale' : '';
  return (
    <aside className="term-col">
      <section className={`term-panel period-panel${t && isSmallSample(t) ? ' term-small' : ''}${stale}`}>
        <h2 className="term-panel-title">Période {periodLabel(period)}</h2>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !t ? <p className="term-dim">…</p> : (
          <dl className="kpi-list">
            <dt>TRAINS</dt><dd>{nf(t.circulated)}</dd>
            <dt>RÉGUL.</dt><dd>{pct(t.official_regularity_pct)}</dd>
            <dt>SUPPR.</dt><dd>{pct(suppressionPct(t))}</dd>
            <dt>INDEMN.</dt><dd>{nf(Math.round(t.estimated_cost_eur_ht))} € HT</dd>
          </dl>
        )}
      </section>
      <section className={cumul && isSmallSample(cumul) ? 'term-panel term-small' : 'term-panel'}>
        <h2 className="term-panel-title">Indemn. cumul</h2>
        {cumulFailed ? <p className="term-dim">INDISPONIBLE</p> : !cumul ? <p className="term-dim">…</p> : cumul.days === 0 ? <p className="term-dim">AUCUN JOUR TERMINÉ</p> : (
          <>
            <p className="big">{nf(Math.round(cumul.cost_eur_ht))} €</p>
            <p className="term-dim">HT · {nf(cumul.observed)} TRAINS OBS. · COUV {cumul.coverage_pct === null ? '—' : `${cumul.coverage_pct.toLocaleString('fr-FR')} %`}</p>
            {cumul.by_brand.map((b) => <p key={b.brand}>{b.brand} {nf(Math.round(b.cost_eur_ht))} €</p>)}
            <p className="term-dim">OBSERVÉ SEULEMENT, SANS EXTRAPOLATION · DEPUIS LE 20/10</p>
          </>
        )}
      </section>
      <section className={`term-panel${stale}`}>
        <h2 className="term-panel-title">Régularité {periodLabel(period)}</h2>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !stats ? <p className="term-dim">…</p> : (
          <ul className="reg-list">
            {axisRegularity(stats.groups).map((a) => (
              <li key={a.axis} className={a.small ? 'term-small' : undefined}>
                <span className="reg-axis" title={a.axis}>{AXIS_SHORT[a.axis] ?? a.axis.slice(0, 5)}</span>
                <span className={`reg-bar ${tone(a.pct)}`} aria-hidden="true">{charBar(a.pct, 10)}</span>
                <span>{a.pct === null ? '—' : a.pct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })}</span>
                {a.small && <span className="term-dim"> n&lt;30</span>}
              </li>
            ))}
          </ul>
        )}
        {stats && !statsFailed && <p className="term-dim">APPROCHÉE · RETARDS PAR PAS DE 5′</p>}
      </section>
    </aside>
  );
}
