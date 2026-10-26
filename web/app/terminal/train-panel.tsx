import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import type { LiveItem } from '../../lib/map-model';
import { bucketIndex, delayTone } from '../../lib/terminal-model';
import { compensationView, delayBounds, observedAgo, thresholdProgress, type Rules } from '../../lib/train-card';
import { isStale } from '../../lib/map-model';

const eur = (n: number) => n.toFixed(2).replace('.', ',');
const range = (lo: number, hi: number, fmt: (n: number) => string) => (lo === hi ? fmt(hi) : `${fmt(lo)} À ${fmt(hi)}`);
const METER_W = 20;
const meter = (ratio: number) => { const n = Math.round(Math.min(Math.max(ratio, 0), 1) * METER_W); return '█'.repeat(n) + '░'.repeat(METER_W - n); };
const TONE_LABELS = { ontime: 'À L’HEURE', late: 'RETARD', strong: 'FORT RETARD', severe: 'TRÈS FORT RETARD', cancelled: 'ANNULÉ' } as const;

// Fiche du train sélectionné : remplace les statistiques de la colonne de droite.
export default function TrainPanel({ train: t, rules, speed, onClose }: {
  train: LiveItem | null; rules: Rules | null; speed: number | null; onClose: () => void;
}) {
  const now = new Date();
  const close = <button type="button" className="term-btn train-close" onClick={onClose}>← STATISTIQUES</button>;
  if (!t) {
    return (
      <aside className="term-col">
        {close}
        <section className="term-panel train-card"><p className="term-dim">TRAIN TERMINÉ OU HORS DU FLUX</p></section>
      </aside>
    );
  }
  const tone = delayTone(t.delay_s, t.cancelled);
  const delay = Math.max(t.delay_s ?? 0, 0);
  const b = delayBounds(delay);
  const idx = bucketIndex(t.delay_s);
  const cv = !t.cancelled && rules ? compensationView(t.brand, t.delay_s, rules) : null;
  const prog = !t.cancelled && rules ? thresholdProgress(t.brand, t.delay_s, rules) : null;
  const ago = observedAgo(t.last_seen_at, now);
  return (
    <aside className="term-col">
      {close}
      <section className="term-panel train-card">
        <h2 className="term-panel-title">{t.brand} {t.train_number}</h2>
        {t.origin && t.dest && <p>{t.origin} → {t.dest}</p>}
        <p className="term-dim">POSITION ESTIMÉE, PAS UN SUIVI GPS</p>
      </section>
      <section className="term-panel train-card">
        <h2 className="term-panel-title">Retard</h2>
        <p className={`train-big tone-${tone}`}>{tone === 'cancelled' ? 'ANNULÉ' : tone === 'ontime' ? 'À L’HEURE' : `+${Math.round(delay / 60)}′`}</p>
        {tone !== 'cancelled' && (
          <>
            <p className="term-dim">{TONE_LABELS[tone]} · RÉEL ENTRE {Math.round(b.low_s / 60)}′ ET {Math.round(b.high_s / 60)}′</p>
            <p className="meter" aria-label={`Tranche de retard ${TERMINUS_BUCKETS[idx]} minutes`}>
              {TERMINUS_BUCKETS.map((bk, i) => <span key={bk} className={`seg-c s${i}`} aria-hidden="true">{i <= idx ? '██' : '░░'}</span>)}
            </p>
            <p className="term-dim">TRANCHE {TERMINUS_BUCKETS[idx]}′ · RETARDS PUBLIÉS PAR PAS DE 5′</p>
          </>
        )}
      </section>
      {(cv || prog) && (
        <section className="term-panel train-card">
          <h2 className="term-panel-title">Indemnité</h2>
          {cv && (cv.pct_high > 0
            ? <>
                <p className="train-big">{range(cv.pct_low, cv.pct_high, (n) => `${n} %`)}</p>
                <p>{range(cv.eur_low, cv.eur_high, eur)} € / VOYAGEUR HT</p>
              </>
            : <p className="term-dim">AUCUNE AU RETARD ACTUEL</p>)}
          {prog && cv?.next && (
            <>
              <p className="meter" aria-hidden="true">{meter(prog.ratio)}</p>
              <p className="term-dim">PROCHAIN SEUIL : {cv.next.pct} % À +{Math.round(prog.to_s / 60)}′ (DANS {Math.ceil(cv.next.in_s / 60)}′)</p>
            </>
          )}
          <p className="term-dim">THÉORIQUE, PRIX MOYEN 2023 ; LA RÉALITÉ DÉPEND DES DEMANDES.</p>
        </section>
      )}
      <section className="term-panel train-card">
        <h2 className="term-panel-title">Mesure</h2>
        <p>VITESSE {speed === null ? <span className="term-dim">— (À L’ARRÊT OU INCONNUE)</span> : <>≈ {Math.round(speed)} KM/H <span className="term-dim">MOYENNE DU TRONÇON</span></>}</p>
        <p>OBSERVÉ {ago === null ? '—' : ago === 0 ? 'À L’INSTANT' : `IL Y A ${ago} MIN`}</p>
        {isStale(t, now) && <p className="tone-late">DONNÉE PÉRIMÉE : TRAIN NON VU RÉCEMMENT</p>}
      </section>
      {t.cause && (
        <section className="term-panel train-card">
          <h2 className="term-panel-title">Cause</h2>
          <p className="train-cause">{t.cause}</p>
        </section>
      )}
    </aside>
  );
}
