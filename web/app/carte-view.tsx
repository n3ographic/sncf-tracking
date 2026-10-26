'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Map as MlMap, Popup } from 'maplibre-gl';
import {
  applyFilters, axes, isStale, lateCount, toFeatureCollection, trainPosition,
  type Filters, type LiveItem,
} from '../lib/map-model';
import { makeSegment, tracesToLines, type LineCollection, type TraceTable } from '../lib/traces';
import { estimatePosition, segmentSpeedKmh, type Lngl } from '../lib/position';
import { delayTone, type Tone } from '../lib/terminal-model';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const TONE_COLORS: Record<Tone, string> = { ontime: '#3ad13a', late: '#ffd24d', strong: '#ff8c00', severe: '#ff4d4d', cancelled: '#8a8a8a' };
const TONE_LABELS: Record<Tone, string> = { ontime: 'À L’HEURE', late: 'RETARD', strong: 'FORT RETARD', severe: 'TRÈS FORT RETARD', cancelled: 'ANNULÉ' };
type MapLibre = typeof import('maplibre-gl');

// Étiquette qui suit le train sur la carte : nœuds DOM uniquement (textContent), jamais de HTML venant des données.
// Le détail du train est dans la fiche de la colonne de droite.
function popupContent(t: LiveItem): HTMLElement {
  const root = document.createElement('div');
  root.className = 'popup';
  const tone = delayTone(t.delay_s, t.cancelled);
  const title = document.createElement('p');
  title.className = 'popup-title';
  title.textContent = `${t.brand} ${t.train_number}`;
  const delay = document.createElement('p');
  delay.className = `tone-${tone}`;
  delay.textContent = tone === 'cancelled' ? 'ANNULÉ' : `${tone === 'ontime' ? 'À L’HEURE' : `+${Math.round((t.delay_s ?? 0) / 60)}′`}`;
  root.append(title, delay);
  return root;
}

export type Focus = { trip_id: string; at: number } | null;

export default function CarteView({ trains, failed, lastOk, focus, selected, onSelect, onSpeed, overlay }: {
  trains: LiveItem[]; failed: boolean; lastOk: number | null; focus: Focus;
  selected: string | null; onSelect: (trip_id: string | null) => void; onSpeed: (kmh: number | null) => void; overlay: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<MapLibre | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState<Filters>({ brand: 'ALL', axis: 'ALL' });
  const trainsRef = useRef<LiveItem[]>(trains);
  const filtersRef = useRef(filters);
  const showTracksRef = useRef(true);
  const tracksRef = useRef<LineCollection | null>(null);
  const applyTracksRef = useRef<() => void>(() => {});
  const [hasTracks, setHasTracks] = useState(false);
  const [showTracks, setShowTracks] = useState(true);
  // Filtres dépliés sur grand écran, repliés sur mobile (lu après montage : pas d'écart d'hydratation).
  const [ctrlOpen, setCtrlOpen] = useState(true);
  useEffect(() => { if (window.matchMedia('(max-width: 899px)').matches) setCtrlOpen(false); }, []);
  const pathRef = useRef<((a: Lngl, b: Lngl) => Lngl[]) | undefined>(undefined);
  const onSelectRef = useRef(onSelect);
  const onSpeedRef = useRef(onSpeed);
  trainsRef.current = trains;
  onSelectRef.current = onSelect;
  onSpeedRef.current = onSpeed;
  filtersRef.current = filters;

  // Fenêtre ouverte : elle suit son train (déplacée à chaque recalcul) et se met à jour avec les données.
  const followRef = useRef<{ train: LiveItem; text: string; popup: Popup } | null>(null);
  const openPopup = (t: LiveItem, at: [number, number]) => {
    const ml = mlRef.current, m = mapRef.current;
    if (!ml || !m) return;
    const old = followRef.current;
    followRef.current = null; // l'ancienne étiquette qu'on remplace ne doit pas désélectionner
    old?.popup.remove();
    const content = popupContent(t);
    const popup = new ml.Popup({ maxWidth: '200px' }).setLngLat(at).setDOMContent(content).addTo(m);
    const follow = { train: t, text: content.textContent ?? '', popup };
    followRef.current = follow;
    popup.on('close', () => { if (followRef.current === follow) { followRef.current = null; onSelectRef.current(null); } });
    onSelectRef.current(t.trip_id);
  };

  // Carte : montée côté navigateur uniquement.
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    // Les voies sont prêtes quand le fichier est chargé ET la carte initialisée : l'ordre d'arrivée est indifférent.
    applyTracksRef.current = () => {
      const src = map?.getSource('voies') as { setData(d: unknown): void } | undefined;
      if (src && tracksRef.current) src.setData(tracksRef.current);
    };
    const refresh = () => {
      const src = map?.getSource('trains') as { setData(d: unknown): void } | undefined;
      if (src) {
        const byId = new Map(trainsRef.current.map((t) => [t.trip_id, t]));
        const fc = toFeatureCollection(applyFilters(trainsRef.current, filtersRef.current), new Date(), pathRef.current);
        for (const f of fc.features) {
          const t = byId.get(f.properties.trip_id);
          (f.properties as typeof f.properties & { tone: Tone }).tone = t ? delayTone(t.delay_s, t.cancelled) : 'ontime';
        }
        src.setData(fc);
      }
      const f = followRef.current;
      if (f) {
        const at = new Date();
        const pos = trainPosition(trainsRef.current, f.train.trip_id, at, pathRef.current);
        if (pos) f.popup.setLngLat(pos);
        const cur = trainsRef.current.find((x) => x.trip_id === f.train.trip_id);
        if (cur) {
          // L'étiquette suit le retard ; la vitesse du tronçon part vers la fiche.
          const content = popupContent(cur);
          if (content.textContent !== f.text) f.popup.setDOMContent(content);
          f.train = cur;
          f.text = content.textContent ?? '';
          onSpeedRef.current(segmentSpeedKmh(cur, at, pathRef.current));
        }
      }
      setNow(Date.now());
    };
    const timer = setInterval(refresh, 1000);
    (async () => {
      const maplibregl = await import('maplibre-gl');
      // Le worker de la v6 n'est pas résolu par webpack : copié dans public/ par predev et prebuild.
      maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
      if (cancelled || !container.current) return;
      mlRef.current = maplibregl;
      const m = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: [2.5, 46.6], zoom: 5, attributionControl: { compact: true } });
      map = m;
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      m.on('load', () => {
        m.addSource('voies', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'voies', type: 'line', source: 'voies',
          layout: { visibility: showTracksRef.current ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#7a5200', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 2], 'line-opacity': 0.9 },
        });
        applyTracksRef.current();
        m.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'trains', type: 'circle', source: 'trains',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 9, 7],
            'circle-color': ['match', ['get', 'tone'],
              'late', TONE_COLORS.late, 'strong', TONE_COLORS.strong, 'severe', TONE_COLORS.severe, 'cancelled', TONE_COLORS.cancelled, TONE_COLORS.ontime],
            'circle-opacity': ['case', ['get', 'stale'], 0.4, 1],
            'circle-stroke-width': 1, 'circle-stroke-color': '#0a0a0a',
          },
        });
        m.on('click', 'trains', (e) => {
          const id = e.features?.[0]?.properties?.trip_id;
          const t = trainsRef.current.find((x) => x.trip_id === id);
          if (t) openPopup(t, [e.lngLat.lng, e.lngLat.lat]);
        });
        m.on('mouseenter', 'trains', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'trains', () => { m.getCanvas().style.cursor = ''; });
        refresh();
      });
    })();
    return () => { cancelled = true; clearInterval(timer); map?.remove(); mapRef.current = null; };
  }, []);

  // Centrage demandé depuis le top des retards : sans position estimée, rien ne se passe.
  useEffect(() => {
    if (!focus) return;
    const t = trainsRef.current.find((x) => x.trip_id === focus.trip_id);
    const e = t ? estimatePosition(t, new Date(), pathRef.current) : null;
    if (!t || !e || !mapRef.current) return;
    mapRef.current.flyTo({ center: [e.lon, e.lat], zoom: 8 });
    openPopup(t, [e.lon, e.lat]);
  }, [focus]);

  // Fiche fermée depuis la colonne de droite : l'étiquette disparaît (sans redésélectionner).
  useEffect(() => {
    if (selected !== null) return;
    const f = followRef.current;
    if (f) { followRef.current = null; f.popup.remove(); }
  }, [selected]);

  // Case « Afficher les voies » : bascule la visibilité de la couche une fois la carte prête.
  useEffect(() => {
    showTracksRef.current = showTracks;
    const m = mapRef.current;
    if (m?.getLayer('voies')) m.setLayoutProperty('voies', 'visibility', showTracks ? 'visible' : 'none');
  }, [showTracks]);

  // Tracés des voies : chargés une fois ; sans eux (échec, contenu invalide) les trains avancent en ligne droite.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/trace-paires.json');
        const table = (await r.json()) as TraceTable;
        if (alive && r.ok && table.pairs && typeof table.pairs === 'object') {
          pathRef.current = makeSegment(table);
          tracksRef.current = tracesToLines(table);
          setHasTracks(tracksRef.current.features.length > 0);
          applyTracksRef.current();
        }
      } catch {
        /* repli silencieux : lignes droites */
      }
    })();
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => applyFilters(trains, filters), [trains, filters]);
  const moving = useMemo(() => {
    const at = new Date(now);
    return shown.filter((t) => estimatePosition(t, at, pathRef.current)?.state === 'moving').length;
  }, [shown, now]);
  const staleMin = failed && lastOk ? Math.max(1, Math.round((now - lastOk) / 60000)) : null;

  return (
    <section className="carte term-panel" aria-label="Carte des trains en circulation">
      <details className="carte-ctrl" open={ctrlOpen} onToggle={(e) => setCtrlOpen(e.currentTarget.open)}>
        <summary>FILTRES</summary>
        <div className="carte-ctrl-row">
          <label>MARQUE
            <select autoComplete="off" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value as Filters['brand'] })}>
              <option value="ALL">TOUTES</option><option value="INOUI">INOUI</option><option value="OUIGO">OUIGO</option>
            </select>
          </label>
          <label>AXE
            <select autoComplete="off" value={filters.axis} onChange={(e) => setFilters({ ...filters, axis: e.target.value })}>
              <option value="ALL">TOUS</option>
              {axes(trains).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {hasTracks && (
            <label>
              <input type="checkbox" checked={showTracks} onChange={(e) => setShowTracks(e.target.checked)} /> VOIES
            </label>
          )}
        </div>
      </details>
      <div ref={container} className="carte-map" />
      {overlay}
      {failed && (
        <p className="carte-banner" role="status">
          {staleMin === null ? 'DONNÉES INDISPONIBLES' : `DONNÉES NON ACTUALISÉES DEPUIS ${staleMin} MIN`}
        </p>
      )}
      <p className="carte-count" aria-live="polite">
        {shown.length} TRAINS · {moving} EN ROUTE · <span className="tone-strong">{lateCount(shown)} EN RETARD</span>
      </p>
    </section>
  );
}
