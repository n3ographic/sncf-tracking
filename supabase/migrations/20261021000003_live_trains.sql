-- Trains en circulation (plan 2) : consommé par /api/live puis par la carte.
-- Migration additive, lecture seule, security invoker (RLS des tables lues applicable).

-- Un train figure tant que sa circulation existe et que p_now < arrivée prévue + max(retard au terminus, 0)
-- + finished_margin(), annulés compris (circulation_finished appelée avec cancelled = false).
-- « set search_path = '' » conservé : tables lues, hors chemin critique (≈100 trains), tout est qualifié.
create function public.live_trains(p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trip_id', t.trip_id, 'service_date', t.service_date, 'brand', t.brand, 'axis', t.axis,
      'train_number', t.train_number, 'cancelled', c.cancelled,
      'dep_planned', t.dep_planned, 'arr_planned', t.arr_planned,
      'origin', pg_catalog.jsonb_build_object('stop_id', t.origin_stop_id, 'name', so.name),
      'dest', pg_catalog.jsonb_build_object('stop_id', t.dest_stop_id, 'name', sd.name),
      'delay_s', l.delay_s, 'last_seq', l.seq, 'cause', c.cause,
      'comp_pct', coalesce(public.compensation_pct(t.brand, l.delay_s), 0),
      'last_seen_at', c.last_seen_at, 'stops', st.stops)
    order by t.dep_planned, t.trip_id), '[]'::jsonb)
  from public.circulations c
  join public.trips_planned t on t.service_date = c.service_date and t.trip_id = c.trip_id
  left join public.stops so on so.stop_id = t.origin_stop_id
  left join public.stops sd on sd.stop_id = t.dest_stop_id
  -- Dernier arrêt (plus grand stop_sequence) portant un retard numérique.
  left join lateral (
    select d.key::int as seq, d.value::numeric::int as delay_s
    from pg_catalog.jsonb_each(c.stop_delays) d
    -- 9 chiffres au plus : le cast ::int ne peut pas déborder et faire échouer toute la requête.
    where pg_catalog.jsonb_typeof(d.value) = 'number' and d.key ~ '^[0-9]{1,9}$'
    order by d.key::int desc limit 1
  ) l on true
  cross join lateral (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'seq', p.stop_sequence, 'stop_id', p.stop_id, 'name', s.name, 'lat', s.lat, 'lon', s.lon,
        'arr', p.arr_planned, 'dep', p.dep_planned,
        'delay_s', case when pg_catalog.jsonb_typeof(c.stop_delays -> p.stop_sequence::text) = 'number'
                        then (c.stop_delays -> p.stop_sequence::text)::numeric::int end,
        'cancelled', coalesce(c.stop_delays -> p.stop_sequence::text = '"cancelled"'::jsonb, false))
      order by p.stop_sequence), '[]'::jsonb) as stops
    from public.stop_times_planned p
    left join public.stops s on s.stop_id = p.stop_id
    where p.service_date = c.service_date and p.trip_id = c.trip_id
  ) st
  -- Fenêtre calculée sur l'arrivée du plan (trips_planned), comme circulation_measures et stats_period :
  -- le collecteur recopie cette valeur dans circulations à chaque passage, l'écart ne dure qu'entre
  -- un réimport et le passage suivant.
  -- Un train après minuit peut relever du jour de service de la veille.
  where c.service_date >= (p_now at time zone 'Europe/Paris')::date - 1
    and not public.circulation_finished(t.arr_planned, c.terminus_delay_s, false, p_now)
$$;

grant execute on function public.live_trains(timestamptz) to anon;
