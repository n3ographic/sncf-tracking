import { suppressionPct } from '../../lib/dashboard-model';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
import { delayTone, topDelays } from '../../lib/terminal-model';

const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`);

export default function LeftPanel({ trains, liveFailed, stats, statsFailed, onFocus }: {
  trains: LiveItem[]; liveFailed: boolean; stats: StatsPayload | null; statsFailed: boolean; onFocus: (trip_id: string) => void;
}) {
  const top = topDelays(trains, 10);
  const cancelled = trains.filter((t) => t.cancelled);
  return (
    <aside className="term-col">
      <section className="term-panel">
        <h2 className="term-panel-title">Top retards</h2>
        {liveFailed && trains.length === 0 ? <p className="term-dim">INDISPONIBLE</p> : top.length === 0 ? <p className="term-dim">AUCUN RETARD</p> : (
          <ol className="top-list">
            {top.map((t) => {
              const tone = delayTone(t.delay_s, t.cancelled);
              return (
                <li key={t.trip_id}>
                  <button type="button" onClick={() => onFocus(t.trip_id)} title={[t.origin, t.dest].filter(Boolean).join(' → ')}>
                    <span>{t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</span>
                    <span className={`tone-${tone}`}>+{Math.round((t.delay_s ?? 0) / 60)}′</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Suppressions</h2>
        <p>EN CIRCULATION <span className="tone-cancelled">{liveFailed && trains.length === 0 ? '—' : cancelled.length}</span></p>
        {cancelled.slice(0, 5).map((t) => <p key={t.trip_id} className="term-dim">{t.brand} {t.train_number} {t.dest ?? ''}</p>)}
        <p>TAUX 7J {statsFailed || !stats ? <span className="term-dim">{statsFailed ? 'INDISPONIBLE' : '—'}</span> : pct(suppressionPct(stats.totals))}</p>
      </section>
    </aside>
  );
}
