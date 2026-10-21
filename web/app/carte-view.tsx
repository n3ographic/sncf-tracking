'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import {
  applyFilters, axes, delayClass, isStale, lateCount, toFeatureCollection,
  type Filters, type LiveItem,
} from '../lib/map-model';
import { makeSegment, type TraceTable } from '../lib/traces';
import type { Lngl } from '../lib/position';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const REFRESH_MS = 60_000;
const COLORS = { ontime: '#1a9850', late: '#f39c12', severe: '#d73027', cancelled: '#888888' };
const LABELS = { ontime: 'à l’heure', late: 'en retard', severe: 'très en retard', cancelled: 'annulé' };

function popupContent(t: LiveItem, now: Date): HTMLElement {
  const root = document.createElement('div');
  root.className = 'popup';
  const line = (text: string, cls?: string) => {
    const p = document.createElement('p');
    p.textContent = text;
    if (cls) p.className = cls;
    root.appendChild(p);
  };
  const cls = delayClass(t);
  line(`${t.brand} ${t.train_number}`, 'popup-title');
  if (t.origin && t.dest) line(`${t.origin} → ${t.dest}`);
  line(cls === 'cancelled' ? 'Annulé' : `Retard : ${Math.round(Math.max(t.delay_s ?? 0, 0) / 60)} min (${LABELS[cls]})`);
  if (t.cause) line(t.cause, 'popup-cause');
  if (t.comp_eur_per_passenger_ref > 0) line(`Indemnité théorique : ${t.comp_eur_per_passenger_ref.toFixed(2)} € par voyageur (HT)`);
  line('Position estimée.', 'popup-note');
  if (isStale(t, now)) line('Donnée périmée : le train n’a pas été vu récemment.', 'popup-note');
  return root;
}

export default function CarteView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [trains, setTrains] = useState<LiveItem[]>([]);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState<Filters>({ brand: 'ALL', axis: 'ALL' });
  const trainsRef = useRef<LiveItem[]>([]);
  const filtersRef = useRef(filters);
  const pathRef = useRef<((a: Lngl, b: Lngl) => Lngl[]) | undefined>(undefined);
  trainsRef.current = trains;
  filtersRef.current = filters;

  // Carte : montée côté navigateur uniquement.
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    const refresh = () => {
      const src = map?.getSource('trains') as { setData(d: unknown): void } | undefined;
      src?.setData(toFeatureCollection(applyFilters(trainsRef.current, filtersRef.current), new Date(), pathRef.current));
      setNow(Date.now());
    };
    const timer = setInterval(refresh, 1000);
    (async () => {
      const maplibregl = await import('maplibre-gl');
      // Le worker de la v6 n'est pas résolu par webpack : copié dans public/ par predev et prebuild.
      maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
      if (cancelled || !container.current) return;
      const m = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: [2.5, 46.6], zoom: 5, attributionControl: { compact: true } });
      map = m;
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      m.on('load', () => {
        m.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'trains', type: 'circle', source: 'trains',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 9, 8],
            'circle-color': ['match', ['get', 'cls'], 'late', COLORS.late, 'severe', COLORS.severe, 'cancelled', COLORS.cancelled, COLORS.ontime],
            'circle-opacity': ['case', ['get', 'stale'], 0.4, 0.95],
            'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff',
          },
        });
        m.on('click', 'trains', (e) => {
          const id = e.features?.[0]?.properties?.trip_id;
          const t = trainsRef.current.find((x) => x.trip_id === id);
          if (!t) return;
          new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setDOMContent(popupContent(t, new Date())).addTo(map!);
        });
        m.on('mouseenter', 'trains', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'trains', () => { m.getCanvas().style.cursor = ''; });
        refresh();
      });
    })();
    return () => { cancelled = true; clearInterval(timer); map?.remove(); mapRef.current = null; };
  }, []);

  // Tracés des voies : chargés une fois ; sans eux (échec, contenu invalide) les trains avancent en ligne droite.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/trace-paires.json');
        const table = (await r.json()) as TraceTable;
        if (alive && r.ok && table.pairs && typeof table.pairs === 'object') pathRef.current = makeSegment(table);
      } catch {
        /* repli silencieux : lignes droites */
      }
    })();
    return () => { alive = false; };
  }, []);

  // Données : au montage puis toutes les minutes ; en cas d'échec on garde les derniers trains.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { trains: LiveItem[] };
        if (!alive) return;
        setTrains(d.trains);
        setLastOk(Date.now());
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = useMemo(() => applyFilters(trains, filters), [trains, filters]);
  const staleMin = failed && lastOk ? Math.max(1, Math.round((now - lastOk) / 60000)) : null;

  return (
    <div className="carte">
      <div ref={container} className="carte-map" />
      <div className="carte-bar">
        <label>Marque
          <select autoComplete="off" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value as Filters['brand'] })}>
            <option value="ALL">Toutes</option><option value="INOUI">INOUI</option><option value="OUIGO">OUIGO</option>
          </select>
        </label>
        <label>Axe
          <select autoComplete="off" value={filters.axis} onChange={(e) => setFilters({ ...filters, axis: e.target.value })}>
            <option value="ALL">Tous</option>
            {axes(trains).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <p className="carte-count" aria-live="polite">{lateCount(shown)} trains en retard sur {shown.length}</p>
        <a className="carte-link" href="/tableau">Tableau de bord</a>
        <a className="carte-link" href="/methodologie">Méthodologie</a>
      </div>
      {failed && (
        <p className="carte-banner" role="status">
          {staleMin === null ? 'Données indisponibles.' : `Données non actualisées depuis ${staleMin} min.`}
        </p>
      )}
      <p className="carte-foot">
        Positions estimées. Observatoire indépendant, non affilié à SNCF ni à OUIGO.
      </p>
    </div>
  );
}
