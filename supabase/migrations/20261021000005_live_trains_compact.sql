-- live_trains compacte (plafond d'egress Supabase) : /api/live pesait 337 Ko pour 170 trains.
-- Par train, seuls le dernier arrêt portant un retard et le suivant sont renvoyés (de quoi estimer la
-- position) ; sans retard connu, les deux premiers arrêts. Clés nulles omises, stop_id des arrêts et des
-- extrémités retirés, "cancelled" omis quand il est faux, coordonnées arrondies à 3 décimales (~100 m),
-- cause tronquée à 160 caractères.
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
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'seq', w.stop_sequence, 'name', w.name, 'lat', pg_catalog.round(w.lat::numeric, 3),
        'lon', pg_catalog.round(w.lon::numeric, 3), 'arr', w.arr_planned, 'dep', w.dep_planned,
        'delay_s', case when pg_catalog.jsonb_typeof(c.stop_delays -> w.stop_sequence::text) = 'number'
                        then (c.stop_delays -> w.stop_sequence::text)::numeric::int end,
        'cancelled', case when c.stop_delays -> w.stop_sequence::text = '"cancelled"'::jsonb then true end))
      order by w.stop_sequence), '[]'::jsonb) as stops
    from (
      select p.stop_sequence, p.arr_planned, p.dep_planned, s.name, s.lat, s.lon
      from public.stop_times_planned p
      left join public.stops s on s.stop_id = p.stop_id
      where p.service_date = c.service_date and p.trip_id = c.trip_id
        and p.stop_sequence >= coalesce(l.seq, 0)
      order by p.stop_sequence limit 2
    ) w
  ) st
  where c.service_date >= (p_now at time zone 'Europe/Paris')::date - 1
    and not public.circulation_finished(t.arr_planned, c.terminus_delay_s, false, p_now)
$$;
