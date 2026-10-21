-- Mesures (plan 2) : régularité officielle, mesure brute par tranche, indemnités théoriques.
-- Migration additive, lecture seule : fonctions security invoker (RLS des tables lues applicable).

-- Marge après l'arrivée (corrigée du retard) au-delà de laquelle un train est terminé.
-- Pas de « set search_path » : il empêche l'inlining des fonctions SQL (coût mesuré sur stats_period).
-- Sans risque ici : aucune table lue, constante pure. L'avertissement function_search_path_mutable
-- du conseiller Supabase est attendu.
create function public.finished_margin() returns interval
language sql immutable security invoker as $$
  select interval '30 minutes'
$$;

-- Tranche de retard en minutes entières : 0, 1-4, 5-14, 15-29, 30-59, 60-119, 120-179, 180+.
-- Pas de « set search_path » : il empêche l'inlining (appelée une fois par arrêt dans stats_period).
-- Sans risque : aucune table ni fonction utilisateur, seulement des opérateurs entiers. Avertissement
-- function_search_path_mutable du conseiller Supabase attendu.
create function public.delay_bucket(p_delay_s int) returns text
language sql immutable security invoker as $$
  select case
    when p_delay_s is null then null
    when p_delay_s / 60 < 1 then '0'
    when p_delay_s / 60 < 5 then '1-4'
    when p_delay_s / 60 < 15 then '5-14'
    when p_delay_s / 60 < 30 then '15-29'
    when p_delay_s / 60 < 60 then '30-59'
    when p_delay_s / 60 < 120 then '60-119'
    when p_delay_s / 60 < 180 then '120-179'
    else '180+'
  end
$$;

-- Pourcentage du palier au plus grand from_s <= retard ; 0 hors barème ou marque inconnue.
create function public.compensation_pct(p_brand text, p_delay_s int) returns int
language sql stable security invoker set search_path = '' as $$
  select coalesce((select s.pct from public.compensation_scale s
                   where s.brand = p_brand and s.from_s <= p_delay_s
                   order by s.from_s desc limit 1), 0)
$$;

-- Seuil exclusif de la règle au plus grand duration_from_s <= durée prévue.
create function public.regularity_max_delay_s(p_duration_s int) returns int
language sql stable security invoker set search_path = '' as $$
  select r.max_delay_exclusive_s from public.regularity_rule r
  where r.duration_from_s <= p_duration_s
  order by r.duration_from_s desc limit 1
$$;

-- Terminé : annulé, ou arrivée prévue + max(retard, 0) + marge dépassée à p_now.
-- Pas de « set search_path » : il empêche l'inlining (appelée une fois par trajet dans stats_period).
-- Sans risque : aucune table lue, seule fonction utilisateur appelée qualifiée (public.finished_margin),
-- fonctions système résolues dans pg_catalog. Avertissement function_search_path_mutable attendu.
create function public.circulation_finished(p_arr timestamptz, p_terminus_delay_s int, p_cancelled boolean, p_now timestamptz)
returns boolean
language sql stable security invoker as $$
  select coalesce(p_cancelled, false)
    or coalesce(p_arr + pg_catalog.make_interval(secs => greatest(coalesce(p_terminus_delay_s, 0), 0)) + public.finished_margin() < p_now, false)
$$;

-- Une ligne par circulation ; marque, axe et horaires viennent du référentiel théorique.
-- on_time_official, bucket et comp_pct ne sont renseignés que pour les trains ayant circulé
-- (non annulés, retard au terminus connu).
create view public.circulation_measures with (security_invoker = true) as
select c.service_date, c.trip_id, t.brand, t.axis, t.train_number, c.cancelled,
  extract(epoch from t.arr_planned - t.dep_planned)::int as duration_s,
  t.arr_planned, c.terminus_delay_s,
  public.circulation_finished(t.arr_planned, c.terminus_delay_s, c.cancelled, now()) as finished,
  case when not c.cancelled and c.terminus_delay_s is not null
    then c.terminus_delay_s < public.regularity_max_delay_s(extract(epoch from t.arr_planned - t.dep_planned)::int) end as on_time_official,
  case when not c.cancelled then public.delay_bucket(c.terminus_delay_s) end as bucket,
  case when not c.cancelled and c.terminus_delay_s is not null
    then public.compensation_pct(t.brand, c.terminus_delay_s) end as comp_pct
from public.circulations c
join public.trips_planned t on t.service_date = c.service_date and t.trip_id = c.trip_id;

-- Décomptes additifs par marque et axe sur les jours de service [p_from, p_to], trains terminés à p_now
-- seulement (filtre propre à p_now, jamais la colonne finished de la vue).
create function public.stats_period(p_from date, p_to date, p_now timestamptz default now())
returns table (brand text, axis text, metric text, n bigint)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select t.brand, t.axis, t.removed_at, c.trip_id is not null as observed, c.cancelled, c.terminus_delay_s, c.stop_delays,
      (c.trip_id is not null and not c.cancelled and c.terminus_delay_s is not null) as circulated,
      m.on_time_official, m.bucket, m.comp_pct
    from public.trips_planned t
    left join public.circulations c on c.service_date = t.service_date and c.trip_id = t.trip_id
    left join public.circulation_measures m on m.service_date = t.service_date and m.trip_id = t.trip_id
    where t.service_date between p_from and p_to
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(t.arr_planned, c.terminus_delay_s, c.cancelled, p_now) end
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
      coalesce(sum(b.comp_pct) filter (where b.circulated), 0)::bigint as comp_pct_sum
    from base b group by b.brand, b.axis
  )
  select g.brand, g.axis, x.metric, x.n from counts g
  cross join lateral (values ('planned', g.planned), ('observed', g.observed), ('removed_late', g.removed_late),
    ('never_observed', g.never_observed), ('cancelled', g.cancelled), ('no_terminus', g.no_terminus),
    ('circulated', g.circulated), ('on_time_official', g.on_time_official), ('comp_eligible', g.comp_eligible),
    ('comp_pct_sum', g.comp_pct_sum)) x(metric, n)
  union all
  select b.brand, b.axis, 'terminus:' || b.bucket, count(*) from base b where b.circulated group by b.brand, b.axis, b.bucket
  union all
  -- Un décompte par arrêt des circulations terminées (annulées comprises) : nombre → tranche, "cancelled" à part.
  select b.brand, b.axis,
    'stop:' || case when jsonb_typeof(s.value) = 'number' then public.delay_bucket(s.value::numeric::int) else 'cancelled' end,
    count(*)
  from base b cross join lateral jsonb_each(b.stop_delays) s
  where b.observed and (jsonb_typeof(s.value) = 'number' or s.value = '"cancelled"'::jsonb)
  group by 1, 2, 3
$$;

grant execute on function public.finished_margin() to anon;
grant execute on function public.delay_bucket(int) to anon;
grant execute on function public.compensation_pct(text, int) to anon;
grant execute on function public.regularity_max_delay_s(int) to anon;
grant execute on function public.circulation_finished(timestamptz, int, boolean, timestamptz) to anon;
grant execute on function public.stats_period(date, date, timestamptz) to anon;
grant select on public.circulation_measures to anon;
