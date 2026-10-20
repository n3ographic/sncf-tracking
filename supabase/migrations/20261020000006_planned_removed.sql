-- Import statique sans suppression : un trajet retiré du GTFS (souvent une suppression tardive)
-- reste dans trips_planned, marqué removed_at, pour que le collecteur observe encore son CANCELED.
alter table public.trips_planned add column removed_at timestamptz;      -- null = présent dans le dernier import
alter table public.trips_planned add column last_import_at timestamptz;
alter table public.stop_times_planned add column last_import_at timestamptz;

-- Après l'upsert de l'import p_import_at (toutes ses lignes portent last_import_at = p_import_at),
-- en une transaction, pour les dates importées :
--   - trajets absents de l'import : removed_at = now() (conservé s'il l'était déjà), jamais supprimés ;
--   - trajets présents : removed_at = null (réapparition) ;
--   - arrêts obsolètes des trajets présents (séquence disparue) supprimés ; ceux des trajets retirés restent.
create function public.mark_removed(p_service_dates date[], p_import_at timestamptz)
returns table (service_date date, present int, removed int)
language plpgsql security definer set search_path = '' as $$
begin
  update public.trips_planned t set removed_at = coalesce(t.removed_at, now())
  where t.service_date = any (p_service_dates) and t.last_import_at is distinct from p_import_at;

  update public.trips_planned t set removed_at = null
  where t.service_date = any (p_service_dates) and t.last_import_at = p_import_at and t.removed_at is not null;

  delete from public.stop_times_planned s
  using public.trips_planned t
  where s.service_date = any (p_service_dates)
    and t.service_date = s.service_date and t.trip_id = s.trip_id
    and t.last_import_at = p_import_at and s.last_import_at is distinct from p_import_at;

  return query
    select t.service_date, (count(*) filter (where t.removed_at is null))::int, (count(*) filter (where t.removed_at is not null))::int
    from public.trips_planned t where t.service_date = any (p_service_dates)
    group by t.service_date order by t.service_date;
end;
$$;
revoke execute on function public.mark_removed(date[], timestamptz) from public, anon, authenticated;
grant execute on function public.mark_removed(date[], timestamptz) to service_role;
