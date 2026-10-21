-- Compteur cumulé (plan 4b) : un instantané par jour de service terminé de la sortie de stats_period,
-- pour dépasser le plafond de 31 jours sans recalculer tout l'historique. Migration additive.
-- Les décomptes sont bruts (comp_pct_sum, pas d'euros) : prix, places et occupation sont des hypothèses
-- appliquées à la lecture.

create table public.daily_stats (
  service_date date not null,
  brand text not null,
  axis text not null,
  metric text not null,
  n bigint not null,
  computed_at timestamptz not null default now(),
  primary key (service_date, brand, axis, metric)
);

-- Lecture publique seule : RLS sans politique d'écriture, droits d'écriture retirés aux rôles clients.
alter table public.daily_stats enable row level security;
revoke insert, update, delete, truncate on public.daily_stats from anon, authenticated;
create policy anon_read on public.daily_stats for select to anon using (true);

-- Remplace les lignes du jour par la sortie de stats_period(jour, jour) : idempotent, un recalcul ne s'ajoute pas.
create function public.snapshot_day(p_day date, p_now timestamptz default now()) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  written int;
begin
  delete from public.daily_stats where service_date = p_day;
  insert into public.daily_stats (service_date, brand, axis, metric, n)
    select p_day, s.brand, s.axis, s.metric, s.n from public.stats_period(p_day, p_day, p_now) s;
  get diagnostics written = row_count;
  return written;
end
$$;

-- Veille et avant-veille (jours calendaires à Paris), jamais avant le début de la collecte (2026-10-20) :
-- le recalcul de l'avant-veille rattrape les trains terminés tard ou retirés tard.
create function public.snapshot_recent(p_now timestamptz default now()) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  today date := (p_now at time zone 'Europe/Paris')::date;
  d date;
  total int := 0;
begin
  for d in select g::date from pg_catalog.generate_series(today - 2, today - 1, interval '1 day') g loop
    if d >= date '2026-10-20' then
      total := total + public.snapshot_day(d, p_now);
    end if;
  end loop;
  return total;
end
$$;

revoke execute on function public.snapshot_day(date, timestamptz) from public, anon, authenticated;
revoke execute on function public.snapshot_recent(timestamptz) from public, anon, authenticated;

-- Totaux par marque et métrique (tous axes confondus) : quelques dizaines de lignes, jamais de pagination.
create function public.cumul_totals() returns table (brand text, metric text, n bigint, days int, first_day date, last_day date)
language sql stable security invoker set search_path = '' as $$
  with span as (
    select count(distinct service_date)::int as days, min(service_date) as first_day, max(service_date) as last_day
    from public.daily_stats
  )
  select d.brand, d.metric, sum(d.n)::bigint, span.days, span.first_day, span.last_day
  from public.daily_stats d cross join span
  group by d.brand, d.metric, span.days, span.first_day, span.last_day
$$;
revoke execute on function public.cumul_totals() from public;
grant execute on function public.cumul_totals() to anon;

-- Rattrapage unique : tous les jours déjà terminés depuis le début de la collecte.
do $$
declare
  d date;
begin
  for d in select g::date from pg_catalog.generate_series(date '2026-10-20', (now() at time zone 'Europe/Paris')::date - 1, interval '1 day') g loop
    perform public.snapshot_day(d);
  end loop;
end
$$;
