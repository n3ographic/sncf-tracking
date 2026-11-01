-- stats_period : 4,2 s -> 1,0 s (12 jours de données), résultats identiques.
-- Les mesures de circulation_measures sont recalculées depuis un seul passage sur canonical_circulations :
-- la jointure sur la vue la relisait en entier, avec une jointure par fusion à 4 M de comparaisons (rôle anon limité à 3 s).
create or replace function public.stats_period(p_from date, p_to date, p_now timestamp with time zone default now())
 returns table(brand text, axis text, metric text, n bigint)
 language sql stable set search_path to ''
as $function$
  with j as (
    select t.brand, t.axis, t.removed_at, c.trip_id is not null as observed, c.cancelled, c.terminus_delay_s, c.stop_delays, c.cause,
      exists (select 1 from jsonb_each(c.stop_delays) e where e.value = '"cancelled"'::jsonb) as skipped,
      tp.trip_id is not null as has_tp, tp.brand as tp_brand,
      (extract(epoch from (tp.arr_planned - tp.dep_planned)))::integer as duration_s
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    left join public.trips_planned tp on tp.service_date = c.service_date and tp.trip_id = c.trip_id
    where t.service_date between p_from and p_to
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now) end
  ), base as (
    select j.brand, j.axis, j.removed_at, j.observed, j.cancelled, j.terminus_delay_s, j.stop_delays, j.cause, j.skipped,
      (j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()) as circulated,
      (j.observed and not j.cancelled and coalesce(j.terminus_delay_s >= public.aberrant_delay_s(), false)) as aberrant,
      case when j.has_tp and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then j.terminus_delay_s < public.regularity_max_delay_s(j.duration_s) end as on_time_official,
      case when j.has_tp and not j.cancelled and not coalesce(j.terminus_delay_s >= public.aberrant_delay_s(), false)
        then public.delay_bucket(j.terminus_delay_s) end as bucket,
      case when j.has_tp and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then public.compensation_pct(j.tp_brand, j.terminus_delay_s) end as comp_pct,
      case when j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then public.compensation_pct(j.brand, j.terminus_delay_s + public.delay_tolerance_s()) end as comp_pct_high,
      case when j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then case when j.skipped then 0
                  else public.compensation_pct(j.brand, greatest(j.terminus_delay_s - public.delay_tolerance_s(), 0)) end end as comp_pct_low
    from j
  ), counts as (
    select b.brand, b.axis,
      count(*) as planned,
      count(*) filter (where b.observed) as observed,
      count(*) filter (where not b.observed and b.removed_at is not null) as removed_late,
      count(*) filter (where not b.observed and b.removed_at is null) as never_observed,
      count(*) filter (where b.observed and b.cancelled) as cancelled,
      count(*) filter (where b.observed and not b.cancelled and b.terminus_delay_s is null) as no_terminus,
      count(*) filter (where b.circulated) as circulated,
      count(*) filter (where b.circulated and b.on_time_official) as on_time_official,
      count(*) filter (where b.circulated and b.comp_pct > 0) as comp_eligible,
      coalesce(sum(b.comp_pct) filter (where b.circulated), 0)::bigint as comp_pct_sum,
      count(*) filter (where b.aberrant) as aberrant,
      count(*) filter (where b.circulated and b.skipped) as skipped_stop,
      coalesce(sum(b.comp_pct_low) filter (where b.circulated), 0)::bigint as comp_pct_sum_low,
      coalesce(sum(b.comp_pct_high) filter (where b.circulated), 0)::bigint as comp_pct_sum_high
    from base b group by b.brand, b.axis
  )
  select g.brand, g.axis, x.metric, x.n from counts g
  cross join lateral (values ('planned', g.planned), ('observed', g.observed), ('removed_late', g.removed_late),
    ('never_observed', g.never_observed), ('cancelled', g.cancelled), ('no_terminus', g.no_terminus),
    ('circulated', g.circulated), ('on_time_official', g.on_time_official), ('comp_eligible', g.comp_eligible),
    ('comp_pct_sum', g.comp_pct_sum), ('aberrant', g.aberrant), ('skipped_stop', g.skipped_stop),
    ('comp_pct_sum_low', g.comp_pct_sum_low), ('comp_pct_sum_high', g.comp_pct_sum_high)) x(metric, n)
  union all
  select b.brand, b.axis, 'terminus:' || b.bucket, count(*) from base b where b.circulated group by b.brand, b.axis, b.bucket
  union all
  -- Un décompte par arrêt des circulations terminées (annulées comprises) : nombre → tranche, "cancelled" à part.
  -- Les circulations aberrantes en sont exclues, comme des autres mesures.
  select b.brand, b.axis,
    'stop:' || case when jsonb_typeof(s.value) = 'number' then public.delay_bucket(s.value::numeric::int) else 'cancelled' end,
    count(*)
  from base b cross join lateral jsonb_each(b.stop_delays) s
  where b.observed and not b.aberrant and (jsonb_typeof(s.value) = 'number' or s.value = '"cancelled"'::jsonb)
  group by 1, 2, 3
  union all
  -- Causes déclarées : trains circulés, non aberrants, en retard d'au moins 5 min au terminus.
  select q.brand, q.axis, x.metric, x.n from (
    select b.brand, b.axis, public.cause_category(b.cause) as cat, count(*) as trains,
      sum(b.terminus_delay_s)::bigint as delay_s, coalesce(sum(b.comp_pct), 0)::bigint as comp
    from base b where b.circulated and b.terminus_delay_s >= 300 group by 1, 2, 3
  ) q
  cross join lateral (values ('cause:' || q.cat, q.trains), ('cause_delay_s:' || q.cat, q.delay_s), ('cause_comp:' || q.cat, q.comp)) x(metric, n)
$function$;
