# Vérification de la purge (à lancer via execute_sql, résultats du 2026-10-20 dans la Task 6)

```sql
-- 0. Référence : events réels (tous < 1 jour au moment du test).
select count(*), max(id) from public.events where trip_id <> 'TEST-PURGE';

-- 1. Événement factice à J-60, dans un mois absent d'exports → la purge ne le touche pas.
insert into public.events (observed_at, service_date, trip_id, kind, value)
values (now() - interval '60 days', (now() - interval '60 days')::date, 'TEST-PURGE', 'delay', '{"test":true}');
select public.purge_events();                                            -- attendu : 0
select count(*) from public.events where trip_id = 'TEST-PURGE';         -- attendu : 1

-- 2. Mois marqué exporté → la purge le supprime (compter dans une requête séparée : même snapshot sinon).
insert into public.exports (month, release_url, row_count)
values (date_trunc('month', (now() - interval '60 days') at time zone 'Europe/Paris')::date, 'test://purge', 1);
select public.purge_events();                                            -- attendu : 1
select count(*) from public.events where trip_id = 'TEST-PURGE';         -- attendu : 0

-- 3. Nettoyage, puis recompter les events réels (attendu : inchangé).
delete from public.exports where release_url = 'test://purge';

-- 4. TRUNCATE interdit (bloc toujours annulé, quoi qu'il arrive).
do $$ begin
  begin truncate public.events;
  exception when others then raise exception 'TRUNCATE bloqué : %', sqlerrm; end;
  raise exception 'TRUNCATE NON bloqué (annulé par cette exception)';
end $$;                                                                   -- attendu : « TRUNCATE bloqué »
```
