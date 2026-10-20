-- Collecteur : RPC utilisées par l'Edge Function collect, et planification toutes les 2 min.
-- Le secret vit dans Vault (créé hors migration : select vault.create_secret(<aléatoire>, 'collector_secret')),
-- il n'apparaît jamais en clair ici.

-- Vérifie l'en-tête x-collector-secret sans exposer le secret à la fonction.
create function public.collector_secret_ok(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'collector_secret' and decrypted_secret = candidate);
$$;
revoke execute on function public.collector_secret_ok(text) from public, anon, authenticated;
grant execute on function public.collector_secret_ok(text) to service_role;

-- Pour les clés (date de service, trip_id) vues dans le flux : trajet planifié, arrêts prévus
-- et ligne circulations courante. Une ligne par trajet (bien sous la limite max-rows de PostgREST).
create function public.collector_context(p_service_dates date[], p_trip_ids text[])
returns table (
  service_date date, trip_id text, brand text, axis text, train_number text, arr_planned timestamptz,
  stops jsonb, circ jsonb
)
language sql stable set search_path = '' as $$
  select t.service_date, t.trip_id, t.brand, t.axis, t.train_number, t.arr_planned,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'stop_sequence', s.stop_sequence, 'stop_id', s.stop_id,
        'arr_planned', s.arr_planned, 'dep_planned', s.dep_planned) order by s.stop_sequence), '[]')
     from public.stop_times_planned s where s.service_date = t.service_date and s.trip_id = t.trip_id),
    (select to_jsonb(c) from public.circulations c where c.service_date = t.service_date and c.trip_id = t.trip_id)
  from unnest(p_service_dates, p_trip_ids) as k (d, id)
  join public.trips_planned t on t.service_date = k.d and t.trip_id = k.id;
$$;
revoke execute on function public.collector_context(date[], text[]) from public, anon, authenticated;
grant execute on function public.collector_context(date[], text[]) to service_role;

select cron.schedule('collect', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://jsbwehfkvcasuyynfwga.supabase.co/functions/v1/collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
