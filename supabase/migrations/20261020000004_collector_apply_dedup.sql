-- collector_apply : défense en profondeur contre deux lignes circulations de même clé dans un passage
-- (le code pur déduplique déjà), et first_seen_at qui ne peut jamais avancer.
create or replace function public.collector_apply(p_events jsonb, p_circs jsonb, p_feed_ts bigint, p_now timestamptz)
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
  select distinct on (c.service_date, c.trip_id)
    c.service_date, c.trip_id, c.brand, c.axis, c.train_number, c.arr_planned, c.cancelled,
    c.stop_delays, c.terminus_delay_s, c.max_delay_s, c.alert_ids, c.cause, c.first_seen_at, c.last_seen_at
  from jsonb_populate_recordset(null::public.circulations, p_circs) with ordinality as c
  order by c.service_date, c.trip_id, c.ordinality
  on conflict (service_date, trip_id) do update set
    brand = excluded.brand, axis = excluded.axis, train_number = excluded.train_number,
    arr_planned = excluded.arr_planned, cancelled = excluded.cancelled, stop_delays = excluded.stop_delays,
    terminus_delay_s = excluded.terminus_delay_s, max_delay_s = excluded.max_delay_s,
    alert_ids = excluded.alert_ids, cause = excluded.cause,
    first_seen_at = least(public.circulations.first_seen_at, excluded.first_seen_at),
    last_seen_at = excluded.last_seen_at;

  update public.collector_state set last_feed_ts = p_feed_ts, last_run_at = p_now, last_error = null where id = 1;
  return 'applied';
end;
$$;
