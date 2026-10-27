-- Un train par numéro et par jour de service (lecture seule, additif).
-- Cause : le dernier segment d'un trip_id est une date de variante ; au réimport de l'horaire, le collecteur passe d'une
-- variante à l'autre et un train en cours reçoit une seconde ligne dans circulations (l'ancienne, marquée removed_at dans
-- trips_planned, reste figée). Les copies gonflaient trains, indemnités, prévus (COUV) et le flux live.
-- Règle : un train = (service_date, train_number) ; aucune réutilisation d'un numéro le même jour n'existe dans les données.
-- Aucune ligne n'est modifiée ni supprimée : les vues choisissent une copie, les mesures et le live les lisent.

create index if not exists trips_planned_day_number on public.trips_planned (service_date, train_number);
create index if not exists circulations_day_number on public.circulations (service_date, train_number);

-- Trajet prévu retenu : variante présente dans le dernier import, puis import le plus récent, puis plus petit trip_id.
create view public.canonical_trips with (security_invoker = true) as
select distinct on (service_date, train_number) *
from public.trips_planned
order by service_date, train_number, (removed_at is not null), last_import_at desc nulls last, trip_id;

-- Circulation retenue : la plus récemment vue (elle porte le retard final), puis plus petit trip_id.
create view public.canonical_circulations with (security_invoker = true) as
select distinct on (service_date, train_number) *
from public.circulations
order by service_date, train_number, last_seen_at desc nulls last, trip_id;

grant select on public.canonical_trips, public.canonical_circulations to anon;

-- Mêmes colonnes qu'avant ; une ligne par train.
create or replace view public.circulation_measures with (security_invoker = true) as
select c.service_date, c.trip_id, t.brand, t.axis, t.train_number, c.cancelled,
  extract(epoch from t.arr_planned - t.dep_planned)::int as duration_s,
  t.arr_planned, c.terminus_delay_s,
  public.circulation_finished(t.arr_planned, c.terminus_delay_s, c.cancelled, now()) as finished,
  case when not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()
    then c.terminus_delay_s < public.regularity_max_delay_s(extract(epoch from t.arr_planned - t.dep_planned)::int) end as on_time_official,
  case when not c.cancelled and not coalesce(c.terminus_delay_s >= public.aberrant_delay_s(), false)
    then public.delay_bucket(c.terminus_delay_s) end as bucket,
  case when not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()
    then public.compensation_pct(t.brand, c.terminus_delay_s) end as comp_pct,
  (not c.cancelled and coalesce(c.terminus_delay_s >= public.aberrant_delay_s(), false)) as aberrant
from public.canonical_circulations c
join public.trips_planned t on t.service_date = c.service_date and t.trip_id = c.trip_id;

-- Mêmes colonnes et mesures qu'avant ; prévus et circulations rapprochés par numéro et jour, pas par trip_id.
create or replace function public.stats_period(p_from date, p_to date, p_now timestamptz default now())
returns table (brand text, axis text, metric text, n bigint)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select t.brand, t.axis, t.removed_at, c.trip_id is not null as observed, c.cancelled, c.terminus_delay_s, c.stop_delays, c.cause,
      (c.trip_id is not null and not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()) as circulated,
      (c.trip_id is not null and not c.cancelled and coalesce(c.terminus_delay_s >= public.aberrant_delay_s(), false)) as aberrant,
      exists (select 1 from jsonb_each(c.stop_delays) e where e.value = '"cancelled"'::jsonb) as skipped,
      m.on_time_official, m.bucket, m.comp_pct,
      case when c.trip_id is not null and not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()
        then public.compensation_pct(t.brand, c.terminus_delay_s + public.delay_tolerance_s()) end as comp_pct_high,
      case when c.trip_id is not null and not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()
        then case when exists (select 1 from jsonb_each(c.stop_delays) e where e.value = '"cancelled"'::jsonb) then 0
                  else public.compensation_pct(t.brand, greatest(c.terminus_delay_s - public.delay_tolerance_s(), 0)) end end as comp_pct_low
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    left join public.circulation_measures m on m.service_date = c.service_date and m.trip_id = c.trip_id
    where t.service_date between p_from and p_to
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now) end
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
$$;
