-- Purge quotidienne d'events : seulement au-delà de 30 jours ET pour un mois déjà exporté (table exports).
-- C'est le seul DELETE permis sur events ; TRUNCATE est interdit comme UPDATE.

create function public.purge_events() returns int
language sql set search_path = '' as $$
  with purged as (
    delete from public.events
    where observed_at < now() - interval '30 days'
      and date_trunc('month', observed_at at time zone 'Europe/Paris')::date in (select month from public.exports)
    returning 1
  )
  select count(*)::int from purged;
$$;
revoke execute on function public.purge_events() from public, anon, authenticated;

create function public.forbid_events_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'events est append-only : TRUNCATE interdit';
end;
$$;
revoke execute on function public.forbid_events_truncate() from public, anon, authenticated;

create trigger events_no_truncate before truncate on public.events
  for each statement execute function public.forbid_events_truncate();

select cron.schedule('purge', '30 3 * * *', 'select public.purge_events()');
