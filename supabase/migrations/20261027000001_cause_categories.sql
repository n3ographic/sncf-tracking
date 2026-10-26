-- Classification des causes de retard déclarées (additif). Règles publiques et versionnées dans cause_rules ;
-- les modifier puis relancer snapshot_day recalcule l'historique. Seule stats_period est remplacée.

create table public.cause_rules (
  priority int primary key,
  category text not null,
  pattern text not null, -- expression régulière PostgreSQL, appliquée sans tenir compte de la casse
  note text
);

-- Lecture publique seule, comme daily_stats.
alter table public.cause_rules enable row level security;
revoke insert, update, delete, truncate on public.cause_rules from anon, authenticated;
create policy anon_read on public.cause_rules for select to anon using (true);

-- Première règle qui correspond, par priorité croissante. Limites de mots (\m…\M) : « vent » ne doit pas trouver « intervention ».
insert into public.cause_rules (priority, category, pattern, note) values
  (10, 'plusieurs', 'deux incidents distincts', 'appliquée au texte entier'),
  (20, 'enchainement', 'précédent trajet|précédente mission|retardé sur sa précédente|retardé à |se raccorder|correspondance|resté à quai plus longtemps|agent essentiel|membre de l.équipage', null),
  (30, 'meteo', '\m(tempête|météo\w*|climatiques?|intempéries|orages?|vents?|précipitations|inondations?|crues?|neige|verglas|canicule|arbres?|feuilles)\M|chute d.arbre', null),
  (40, 'obstacle', '\m(heurté|heurt|animal|animaux|sanglier|obstacle)\M|choc anormal', null),
  (50, 'voyageurs_surete', '\m(voyageurs?|malaise|personnes?|sûreté|frontière|autorités|colis|bagage|client|manifestations?)\M|état de santé|signal d.alarme|périmètre de sécurité|conditions de sécurité', null),
  (60, 'infrastructure', '\m(travaux|aiguillage|caténaire|signalisation|voie)\M|alimentation électrique|défaut affectant la voie|passage à niveau|appareils de voie|gestionnaire du réseau|dysfonctionnement électrique|réseau ferré', null),
  (70, 'materiel', '\m(matériel|maintenance|rame|réparations?|dépannage)\M|panne de votre train|formation du train|panne matériel|vérifications techniques|dysfonctionnement sur votre train|lieu de garage|opérations de départ', null),
  (80, 'regulation', '\m(ralentir|ralentissements?)\M|densité du trafic|train circulant devant|distance de sécurité|panne d.un (autre )?train|régulation|roule actuellement doublé', null),
  (90, 'information', 'itinéraire|ne desservi|fin des perturbations|exceptionnellement|équipement de vente', 'conséquence annoncée, sans cause'),
  (100, 'exploitation', 'incident d.exploitation', null);

-- Catégorie d'un texte d'alerte. Texte classé : la phrase qui suit « Cause : », sinon les 200 premiers caractères
-- (les phrases d'habillage en fin de message faussent le classement). « plusieurs » se teste sur le texte entier.
create function public.cause_category(p_cause text) returns text
language sql stable security invoker set search_path = '' as $$
  select case when p_cause is null then 'sans_cause' else coalesce((
    select r.category from public.cause_rules r
    where case when r.category = 'plusieurs' then lower(p_cause)
               else lower(coalesce(substring(p_cause from '(?i)cause ?: ?([^.]*)'), left(p_cause, 200))) end ~* r.pattern
    order by r.priority limit 1), 'autre') end
$$;

grant execute on function public.cause_category(text) to anon;

-- Mêmes colonnes et mêmes mesures qu'avant, plus cause:<code>, cause_delay_s:<code> et cause_comp:<code>.
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

-- Rattrapage unique : recalcule les jours déjà enregistrés pour y ajouter les mesures par cause (idempotent).
do $$
declare
  d date;
begin
  for d in select g::date from pg_catalog.generate_series(date '2026-10-20', (now() at time zone 'Europe/Paris')::date - 1, interval '1 day') g loop
    perform public.snapshot_day(d);
  end loop;
end
$$;
