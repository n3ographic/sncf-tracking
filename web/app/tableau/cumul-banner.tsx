'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSmallSample } from '../../lib/dashboard-model';
import type { Cumul } from '../../lib/cumul';

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} € HT`;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });

export default function CumulBanner() {
  const [data, setData] = useState<Cumul | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch('/api/cumul');
      const d = (await r.json()) as Cumul;
      if (!r.ok || !Array.isArray(d.by_brand)) throw new Error(String(r.status));
      setData(d);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className={data && isSmallSample(data) ? 'cumul small' : 'cumul'} aria-labelledby="cumul-title">
      <h2 id="cumul-title">Depuis le 20 octobre 2026</h2>
      {error && (
        <p className="tb-error" role="alert">Compteur indisponible. <button type="button" onClick={load}>Réessayer</button></p>
      )}
      {!error && !data && <p role="status">Chargement…</p>}
      {data && !error && (data.days === 0 ? (
        <p>Aucun jour terminé pour le moment.</p>
      ) : (
        <>
          <p className="cumul-big">{eur(data.cost_eur_ht)}</p>
          <p>
            d’indemnités théoriques sur {data.observed.toLocaleString('fr-FR')} trains observés
            (couverture : {data.coverage_pct === null ? '—' : `${data.coverage_pct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`} des trains prévus),
            du {day(data.since!)} au {day(data.through!)}.
            {isSmallSample(data) && <strong> Échantillon trop petit pour conclure.</strong>}
          </p>
          <ul>
            {data.by_brand.map((b) => (
              <li key={b.brand}>{b.brand} : {eur(b.cost_eur_ht)} ({b.circulated} trains ayant circulé, dont {b.comp_eligible} ouvrant droit à indemnité)</li>
            ))}
          </ul>
          <p className="cumul-note">
            Observé seulement : les trains non observés ne sont pas comptés, le compteur sous-estime donc la réalité tant que la couverture est faible.
            Aucune extrapolation. Occupation de référence {data.assumptions.occupancy.toLocaleString('fr-FR')}, hypothèse non sourcée.
          </p>
        </>
      ))}
    </section>
  );
}
