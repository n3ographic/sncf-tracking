// Sondage des flux GTFS-RT SNCF et de leur jointure avec le GTFS statique (Task 1).
// Usage : npm run inspect  — les flux bruts sont gardés dans tmp/snapshots/ (git-ignoré).
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'csv-parse/sync';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const TU_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates';
const SA_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts';
const GTFS_URL = 'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip';
const GTFS_ZIP = 'tmp/gtfs.zip';

// Marque déduite du trip_id statique (voir docs/findings/2026-10-20-sondage-flux.md).
const brandOf = (tripId: string) =>
  tripId.includes(':OUI:') ? 'INOUI' : tripId.includes(':OGO:') ? 'OUIGO' : null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

type Row = Record<string, string>;
const csv = (files: Record<string, Uint8Array>, name: string): Row[] =>
  parse(strFromU8(files[name]), { columns: true, skip_empty_lines: true, bom: true });

// protobufjs expose les valeurs par défaut via le prototype : on teste la présence réelle du champ.
const own = (o: object | null | undefined, k: string) => o != null && Object.hasOwn(o, k);
// Identifiant court utilisé par les alertes : « OCESN6153F » pour « OCESN6153F1187_F:OUI:… ».
const shortId = (tripId: string) => tripId.match(/^OCE[A-Z]+\d+[A-Z]/)?.[0] ?? tripId;

const count = <T>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
};

mkdirSync('tmp/snapshots', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const [tuBytes, saBytes] = await Promise.all([fetchBytes(TU_URL), fetchBytes(SA_URL)]);
writeFileSync(`tmp/snapshots/${stamp}-tu.pb`, tuBytes);
writeFileSync(`tmp/snapshots/${stamp}-sa.pb`, saBytes);
const tu = FeedMessage.decode(tuBytes);
const sa = FeedMessage.decode(saBytes);

if (!existsSync(GTFS_ZIP)) writeFileSync(GTFS_ZIP, await fetchBytes(GTFS_URL));
const files = unzipSync(readFileSync(GTFS_ZIP), {
  filter: (f) => ['agency.txt', 'routes.txt', 'trips.txt', 'calendar_dates.txt'].includes(f.name),
});
const agencies = csv(files, 'agency.txt');
const routes = new Map(csv(files, 'routes.txt').map((r) => [r.route_id, r]));
const trips = new Map(csv(files, 'trips.txt').map((t) => [t.trip_id, t]));
const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Paris' }).replaceAll('-', '');
const servicesToday = new Set(csv(files, 'calendar_dates.txt').filter((c) => c.date === today && c.exception_type === '1').map((c) => c.service_id));

console.log('== En-têtes');
console.log('TU', tu.header?.gtfsRealtimeVersion, 'ts', String(tu.header?.timestamp), `${tuBytes.length} o`);
console.log('SA', sa.header?.gtfsRealtimeVersion, 'ts', String(sa.header?.timestamp), `${saBytes.length} o`);

const tuEntities = tu.entity.filter((e) => e.tripUpdate);
const rtIds = tuEntities.map((e) => e.tripUpdate!.trip.tripId ?? '');
console.log('\n== Trip Updates :', tu.entity.length, 'entités,', tuEntities.length, 'trip_update');
console.log('exemples trip_id flux :', rtIds.slice(0, 5));
console.log('exemples trip_id statique :', [...trips.keys()].filter((id) => brandOf(id)).slice(0, 5));

const joined = rtIds.filter((id) => trips.has(id));
console.log(`jointure globale : ${joined.length}/${rtIds.length} = ${((100 * joined.length) / rtIds.length).toFixed(1)} %`);

// TGV côté flux : on ne peut juger la marque que via le trip_id (ou le statique).
const rtTgv = rtIds.filter((id) => brandOf(id));
const rtTgvJoined = rtTgv.filter((id) => trips.has(id));
console.log(`TGV dans le flux (marque lisible dans trip_id) : ${rtTgv.length}`, count(rtTgv.map(brandOf)));
console.log(`jointure TGV : ${rtTgvJoined.length}/${rtTgv.length} = ${((100 * rtTgvJoined.length) / (rtTgv.length || 1)).toFixed(1)} %`);
console.log('non joints (TGV) exemples :', rtTgv.filter((id) => !trips.has(id)).slice(0, 5));
console.log('codes service (2e segment trip_id) flux :', count(rtIds.map((id) => id.split(':')[1])));

console.log('\n== Agences statiques :', agencies.map((a) => `${a.agency_id}=${a.agency_name}`).join(', '));
const tgvRoutes = rtTgvJoined.map((id) => routes.get(trips.get(id)!.route_id));
console.log('agences des TGV du flux :', count(tgvRoutes.map((r) => r?.agency_id)));
console.log('routes distinctes des TGV du flux :', new Set(tgvRoutes.map((r) => r?.route_id)).size);
console.log('exemples routes :', [...new Set(tgvRoutes.map((r) => `${r?.route_short_name} ${r?.route_long_name}`))].slice(0, 8));

const tgvUpdates = tuEntities.filter((e) => brandOf(e.tripUpdate!.trip.tripId ?? '')).map((e) => e.tripUpdate!);
const stus = tgvUpdates.flatMap((u) => u.stopTimeUpdate ?? []);
const has = (f: (s: (typeof stus)[number]) => unknown) => stus.filter(f).length;
console.log('\n== stop_time_update TGV :', stus.length);
console.log('arrival.delay', has((s) => own(s.arrival, 'delay')), '| arrival.time', has((s) => own(s.arrival, 'time')));
console.log('departure.delay', has((s) => own(s.departure, 'delay')), '| departure.time', has((s) => own(s.departure, 'time')));
console.log('stop_id renseigné', has((s) => own(s, 'stopId')), '| stop_sequence', has((s) => own(s, 'stopSequence')));
console.log('schedule_relationship stop (0=SCHEDULED, 1=SKIPPED) :', count(stus.map((s) => s.scheduleRelationship)));
console.log('schedule_relationship trip (0=SCHEDULED, 3=CANCELED) :', count(tgvUpdates.map((u) => u.trip.scheduleRelationship)));
console.log('tripUpdate.delay renseigné :', tgvUpdates.filter((u) => own(u, 'delay')).length);
console.log('retards non nuls :', has((s) => (s.arrival?.delay ?? 0) !== 0 || (s.departure?.delay ?? 0) !== 0));
const plannedToday = [...trips.values()].filter((t) => brandOf(t.trip_id) && servicesToday.has(t.service_id));
console.log(`couverture : ${rtTgv.length} TGV dans le flux / ${plannedToday.length} TGV prévus le ${today} au statique`, count(plannedToday.map((t) => brandOf(t.trip_id))));
console.log('exemple stop_time_update :', JSON.stringify(stus[0]));

console.log('\n== Service Alerts :', sa.entity.length, 'entités');
const ies = sa.entity.flatMap((e) => e.alert?.informedEntity ?? []);
console.log('formes informed_entity :', count(ies.map((ie) => Object.keys(ie).sort().join('+'))));
console.log('exemple informed_entity :', JSON.stringify(ies[0]));
const alertTrips = new Set(ies.map((ie) => ie.trip?.tripId).filter(Boolean));
console.log('exemples trip_id d\'alerte :', [...alertTrips].slice(0, 5));
console.log('trip_id d\'alerte identiques à un trip_id TU :', [...alertTrips].filter((id) => rtIds.includes(id!)).length, '/', alertTrips.size);
console.log('TGV du flux visés par une alerte (id court) :', rtTgv.filter((id) => alertTrips.has(shortId(id))).length, '/', rtTgv.length);
console.log('langues header_text :', count(sa.entity.flatMap((e) => e.alert?.headerText?.translation?.map((t) => t.language ?? '') ?? [])));

// État TGV d'un snapshot, au grain des events prévus : retard par arrêt, suppression, alertes.
type Decoded = InstanceType<typeof FeedMessage>;
function tgvState(tuMsg: Decoded, saMsg: Decoded) {
  const alertsByTrip = new Map<string, Set<string>>();
  for (const e of saMsg.entity)
    for (const ie of e.alert?.informedEntity ?? []) {
      const id = ie.trip?.tripId;
      if (id) alertsByTrip.set(id, (alertsByTrip.get(id) ?? new Set()).add(e.id));
    }
  const state = new Map<string, { cancelled: boolean; stops: Map<string, number | 'skipped'>; alerts: Set<string> }>();
  for (const e of tuMsg.entity) {
    const u = e.tripUpdate;
    if (!u || !brandOf(u.trip.tripId ?? '')) continue;
    const stops = new Map((u.stopTimeUpdate ?? []).map((s) => [
      s.stopId ?? '',
      s.scheduleRelationship === 1 ? ('skipped' as const) : ((s.arrival ?? s.departure)?.delay ?? 0),
    ]));
    state.set(`${u.trip.startDate}|${u.trip.tripId}`, {
      cancelled: u.trip.scheduleRelationship === 3,
      stops,
      alerts: alertsByTrip.get(shortId(u.trip.tripId!)) ?? new Set(),
    });
  }
  return state;
}

// Comparaison avec le snapshot précédent le plus récent datant d'au moins 9 min (estimation du volume d'events).
const older = readdirSync('tmp/snapshots')
  .filter((f) => f.endsWith('-tu.pb') && f < `${stamp}-tu.pb`)
  .map((f) => f.slice(0, -'-tu.pb'.length))
  .filter((p) => existsSync(`tmp/snapshots/${p}-sa.pb`))
  .map((p) => ({ p, tu: FeedMessage.decode(readFileSync(`tmp/snapshots/${p}-tu.pb`)) }))
  .filter((x) => Number(tu.header.timestamp) - Number(x.tu.header.timestamp) >= 540)
  .at(-1);
if (older) {
  const prev = tgvState(older.tu, FeedMessage.decode(readFileSync(`tmp/snapshots/${older.p}-sa.pb`)));
  const next = tgvState(tu, sa);
  const k = { first_seen: 0, delay: 0, stop_cancelled: 0, cancelled: 0, uncancelled: 0, alert_added: 0, alert_removed: 0 };
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) k.first_seen++;
    if ((p?.cancelled ?? false) !== n.cancelled) k[n.cancelled ? 'cancelled' : 'uncancelled']++;
    for (const [stop, v] of n.stops)
      if (p?.stops.get(stop) !== v && (p || v !== 0)) k[v === 'skipped' ? 'stop_cancelled' : 'delay']++;
    for (const a of n.alerts) if (!p?.alerts.has(a)) k.alert_added++;
    for (const a of p?.alerts ?? []) if (!n.alerts.has(a)) k.alert_removed++;
  }
  const dt = Number(tu.header.timestamp) - Number(older.tu.header.timestamp);
  const total = Object.values(k).reduce((a, b) => a + b, 0);
  const gone = [...prev.keys()].filter((id) => !next.has(id)).length;
  console.log(`\n== Changements TGV depuis ${older.p} (${dt} s) :`, k);
  console.log(`total ${total} events, ${gone} trajets disparus ; extrapolation ${Math.round((total * 86400) / dt)} events/jour`);
}
console.log('\nsnapshot :', `tmp/snapshots/${stamp}-tu.pb`);
