'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CarteView, { type Focus } from '../carte-view';
import type { Cumul } from '../../lib/cumul';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
import { collectStatus, periodQuery, tickerItems, type Period } from '../../lib/terminal-model';
import FootBar from './foot-bar';
import GroupsPanel from './groups-panel';
import LeftPanel from './left-panel';
import PeriodPicker from './period-picker';
import RightPanel from './right-panel';
import StatusBar from './status-bar';
import Ticker from './ticker';

const REFRESH_MS = 60_000;

// Charge les trois sources une fois pour tout l'écran ; chaque panneau gère l'échec de la sienne.
export default function TerminalView() {
  const [trains, setTrains] = useState<LiveItem[]>([]);
  const [liveFailed, setLiveFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [cumul, setCumul] = useState<Cumul | null>(null);
  const [cumulFailed, setCumulFailed] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('7d');
  const statsSeq = useRef(0);
  const [focus, setFocus] = useState<Focus>(null);

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
        setLiveFailed(false);
      } catch {
        if (alive) setLiveFailed(true); // on garde les derniers trains
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/cumul');
        const d = (await r.json()) as Cumul;
        if (!r.ok || !Array.isArray(d.by_brand)) throw new Error(String(r.status));
        if (alive) setCumul(d);
      } catch {
        if (alive) setCumulFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Seule la dernière période demandée écrit l'état : une réponse arrivée trop tard est ignorée.
  const loadStats = useCallback(async (p: Period) => {
    const mine = ++statsSeq.current;
    setStatsLoading(true);
    setStatsFailed(false);
    try {
      const r = await fetch(`/api/stats?${periodQuery(p)}`);
      const d = (await r.json()) as StatsPayload;
      if (!r.ok || !Array.isArray(d.groups) || !d.totals) throw new Error(String(r.status));
      if (mine === statsSeq.current) setStats(d);
    } catch {
      if (mine === statsSeq.current) setStatsFailed(true);
    } finally {
      if (mine === statsSeq.current) setStatsLoading(false);
    }
  }, []);
  useEffect(() => { loadStats(period); }, [period, loadStats]);
  const reloadStats = useCallback(() => loadStats(period), [period, loadStats]);

  const onFocus = useCallback((trip_id: string) => setFocus({ trip_id, at: Date.now() }), []);
  const items = useMemo(() => tickerItems(trains, 15), [trains]);
  const status = liveFailed && trains.length === 0 ? { status: 'unknown' as const, ageMin: null } : collectStatus(trains, new Date());

  return (
    <div className="term">
      <StatusBar status={status} coveragePct={cumul?.coverage_pct ?? null} picker={<PeriodPicker value={period} onChange={setPeriod} />} />
      <Ticker items={items} failed={liveFailed} />
      <main className="term-grid">
        <h1 className="sr-only">Observatoire TGV : trains en circulation, retards et indemnités théoriques</h1>
        <LeftPanel trains={trains} liveFailed={liveFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} onFocus={onFocus} />
        <div className="term-center">
          <CarteView trains={trains} failed={liveFailed} lastOk={lastOk} focus={focus} />
          <GroupsPanel stats={stats} failed={statsFailed} loading={statsLoading} period={period} onRetry={reloadStats} />
        </div>
        <RightPanel cumul={cumul} cumulFailed={cumulFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} />
      </main>
      <FootBar />
    </div>
  );
}
