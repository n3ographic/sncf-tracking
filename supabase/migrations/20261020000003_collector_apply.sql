-- Correctifs du collecteur : écritures atomiques et jointure tolérante à la variante de calendrier.

-- Le flux RT peut porter un trip_id dont seul le dernier segment :AAAAMMJJ diffère du statique importé.
-- On joint sur le trip_id sans ce segment ; le trip_id renvoyé est celui du plan (clé stable).
create or replace function public.collector_context(p_service_dates date[], p_trip_ids text[])
returns table (
  service_date date, trip_id text, brand text, axis text, train_number text, arr_planned timestamptz,
  stops jsonb, circ jsonb
)
language sql stable set search_path = '' as $$
  select distinct on (t.service_date, t.trip_id)
    t.service_date, t.trip_id, t.brand, t.axis, t.train_number, t.arr_planned,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'stop_sequence', s.stop_sequence, 'stop_id', s.stop_id,
        'arr_planned', s.arr_planned, 'dep_planned', s.dep_planned) order by s.stop_sequence), '[]')
     from public.stop_times_planned s where s.service_date = t.service_date and s.trip_id = t.trip_id),
    (select to_jsonb(c) from public.circulations c where c.service_date = t.service_date and c.trip_id = t.trip_id)
  from unnest(p_service_dates, p_trip_ids) as k (d, id)
  join public.trips_planned t on t.service_date = k.d
    and regexp_replace(t.trip_id, ':[0-9]{8}$', '') = regexp_replace(k.id, ':[0-9]{8}$', '');
$$;

-- Applique un passage en une transaction : events, circulations, puis collector_state.
-- Verrou sur collector_state : deux passages concurrents ne valident jamais deux fois le même flux.
create function public.collector_apply(p_events jsonb, p_circs jsonb, p_feed_ts bigint, p_now timestamptz)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_last bigint;
begin
  insert into public.collector_state (id) values (1) on conflict (id) do nothing;
  select last_feed_ts into v_last from public.collector_state where id = 1 for update;
  if v_last is not null and p_feed_ts <= v_last then
    return 'stale';
  end if;

  insert into public.events (observed_at, service_date, trip_id, kind, stop_sequence, value)
  select e.observed_at, e.service_date, e.trip_id, e.kind, e.stop_sequence, e.value
  from jsonb_populate_recordset(null::public.events, p_events) e;

  insert into public.circulations (service_date, trip_id, brand, axis, train_number, arr_planned, cancelled,
    stop_delays, terminus_delay_s, max_delay_s, alert_ids, cause, first_seen_at, last_seen_at)
  select c.service_date, c.trip_id, c.brand, c.axis, c.train_number, c.arr_planned, c.cancelled,
    c.stop_delays, c.terminus_delay_s, c.max_delay_s, c.alert_ids, c.cause, c.first_seen_at, c.last_seen_at
  from jsonb_populate_recordset(null::public.circulations, p_circs) c
  on conflict (service_date, trip_id) do update set
    brand = excluded.brand, axis = excluded.axis, train_number = excluded.train_number,
    arr_planned = excluded.arr_planned, cancelled = excluded.cancelled, stop_delays = excluded.stop_delays,
    terminus_delay_s = excluded.terminus_delay_s, max_delay_s = excluded.max_delay_s,
    alert_ids = excluded.alert_ids, cause = excluded.cause,
    first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at;

  update public.collector_state set last_feed_ts = p_feed_ts, last_run_at = p_now, last_error = null where id = 1;
  return 'applied';
end;
$$;
revoke execute on function public.collector_apply(jsonb, jsonb, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.collector_apply(jsonb, jsonb, bigint, timestamptz) to service_role;
