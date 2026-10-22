import { isSmallSample } from '../../lib/dashboard-model';
import type { Cumul } from '../../lib/cumul';
import type { StatsPayload } from '../../lib/stats';
import { axisRegularity, charBar } from '../../lib/terminal-model';

const nf = (n: number) => n.toLocaleString('fr-FR');
const AXIS_SHORT: Record<string, string> = { ATLANTIQUE: 'ATL', EST: 'EST', INTERSECTEURS: 'INTER', NORD: 'NORD', SUD_EST: 'S-EST' };
const tone = (p: number | null) => (p === null ? 'term-dim' : p >= 80 ? 'tone-ontime' : p >= 60 ? 'tone-late' : p >= 40 ? 'tone-strong' : 'tone-severe');

export default function RightPanel({ cumul, cumulFailed, stats, statsFailed }: {
  cumul: Cumul | null; cumulFailed: boolean; stats: StatsPayload | null; statsFailed: boolean;
}) {
  return (
    <aside className="term-col">
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
      <section className="term-panel">
        <h2 className="term-panel-title">Régularité 7j</h2>
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
