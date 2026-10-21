-- live_trains : fenêtre d'arrêts choisie selon l'heure (correctif).
-- Le flux publie un retard prévisionnel pour tous les arrêts restants, terminus compris : « le dernier arrêt portant
-- un retard » était donc presque toujours le terminus et tous les trains étaient dessinés à leur arrivée.
-- Désormais, pour chaque arrêt : heure effective de départ = départ prévu (ou arrivée prévue) + retard, le retard d'un
-- arrêt sans valeur reprenant celui de l'arrêt précédent connu. La fenêtre commence au dernier arrêt dont le départ
-- effectif est passé (au premier arrêt si aucun) et contient trois arrêts (de quoi tenir les minutes de cache).
-- `delay_s` d'un arrêt = retard publié ou reporté (absent si aucun retard connu). Le reste de la réponse est inchangé.
create or replace function public.live_trains(p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'trip_id', t.trip_id, 'service_date', t.service_date, 'brand', t.brand, 'axis', t.axis,
      'train_number', t.train_number, 'cancelled', c.cancelled,
      'dep_planned', t.dep_planned, 'arr_planned', t.arr_planned,
      'origin', so.name, 'dest', sd.name,
      'delay_s', l.delay_s, 'last_seq', l.seq, 'cause', pg_catalog.left(c.cause, 160),
      'comp_pct', coalesce(public.compensation_pct(t.brand, l.delay_s), 0),
      'last_seen_at', c.last_seen_at, 'stops', st.stops))
    order by t.dep_planned, t.trip_id), '[]'::jsonb)
  from public.circulations c
  join public.trips_planned t on t.service_date = c.service_date and t.trip_id = c.trip_id
  left join public.stops so on so.stop_id = t.origin_stop_id
  left join public.stops sd on sd.stop_id = t.dest_stop_id
  left join lateral (
    select d.key::int as seq, d.value::numeric::int as delay_s
    from pg_catalog.jsonb_each(c.stop_delays) d
    where pg_catalog.jsonb_typeof(d.value) = 'number' and d.key ~ '^[0-9]{1,9}$'
    order by d.key::int desc limit 1
  ) l on true
  cross join lateral (
    with s as (
      select p.stop_sequence as seq, p.arr_planned, p.dep_planned, g.name, g.lat, g.lon,
        case when pg_catalog.jsonb_typeof(c.stop_delays -> p.stop_sequence::text) = 'number'
             then (c.stop_delays -> p.stop_sequence::text)::numeric::int end as own,
        coalesce(c.stop_delays -> p.stop_sequence::text = '"cancelled"'::jsonb, false) as cancelled
      from public.stop_times_planned p
      left join public.stops g on g.stop_id = p.stop_id
      where p.service_date = c.service_date and p.trip_id = c.trip_id
    ), e as (
      select s.*, coalesce(s.own, (select x.own from s x where x.seq < s.seq and x.own is not null order by x.seq desc limit 1)) as known
      from s
    ), f as (
      select e.*, coalesce(e.dep_planned, e.arr_planned) + pg_catalog.make_interval(secs => greatest(coalesce(e.known, 0), 0)) as eff_dep
      from e
    ), a as (
      select coalesce(max(f.seq) filter (where f.eff_dep <= p_now), min(f.seq)) as seq from f
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'seq', w.seq, 'name', w.name, 'lat', pg_catalog.round(w.lat::numeric, 3), 'lon', pg_catalog.round(w.lon::numeric, 3),
        'arr', w.arr_planned, 'dep', w.dep_planned,
        'delay_s', case when not w.cancelled then w.known end,
        'cancelled', case when w.cancelled then true end)) order by w.seq), '[]'::jsonb) as stops
    from (select f.* from f cross join a where f.seq >= a.seq order by f.seq limit 3) w
  ) st
  where c.service_date >= (p_now at time zone 'Europe/Paris')::date - 1
    and not public.circulation_finished(t.arr_planned, c.terminus_delay_s, false, p_now)
$$;
