# Vérification de mark_removed et collector_apply v2 (via execute_sql, blocs toujours annulés)

Résultats du 2026-10-20 dans `.superpowers/sdd/2026-10-20-plan-1-collecte-archive/final-fix-report.md`.

```sql
-- mark_removed : trajet absent marqué (pas supprimé), trajet revenu démarqué, arrêt obsolète d'un trajet
-- présent supprimé, arrêts du trajet retiré conservés, collector_context renvoie encore le trajet retiré.
-- attendu : [2099-01-01 present=2 removed=1] T-ABSENT removed=t; T-PRESENT removed=f; T-RETOUR removed=f;
--           st T-ABSENT/0; st T-PRESENT/0;  ctx=1
do $$ declare r record; v text := ''; imp timestamptz := '2099-01-01 02:15+00'; begin
  insert into public.trips_planned (service_date, trip_id, brand, train_number, axis, last_import_at, removed_at) values
   ('2099-01-01','T-ABSENT','INOUI','1','NORD','2098-12-31', null),
   ('2099-01-01','T-RETOUR','INOUI','2','NORD', imp, '2098-12-31'),
   ('2099-01-01','T-PRESENT','INOUI','3','NORD', imp, null);
  insert into public.stop_times_planned (service_date, trip_id, stop_sequence, stop_id, last_import_at) values
   ('2099-01-01','T-ABSENT',0,'S','2098-12-31'), ('2099-01-01','T-PRESENT',0,'S',imp), ('2099-01-01','T-PRESENT',1,'S','2098-12-31');
  for r in select * from public.mark_removed(array['2099-01-01'::date], imp) loop v := v || format('[%s present=%s removed=%s] ', r.service_date, r.present, r.removed); end loop;
  for r in select trip_id, removed_at is not null rm from public.trips_planned where service_date='2099-01-01' order by 1 loop v := v || format('%s removed=%s; ', r.trip_id, r.rm); end loop;
  for r in select trip_id, stop_sequence from public.stop_times_planned where service_date='2099-01-01' order by 1,2 loop v := v || format('st %s/%s; ', r.trip_id, r.stop_sequence); end loop;
  v := v || ' ctx=' || (select count(*) from public.collector_context(array['2099-01-01'::date], array['T-ABSENT']));
  raise exception 'ROLLBACK %', v;
end $$;

-- collector_apply : stale ne touche que last_run_at ; conflict n'écrit rien ; applied écrit l'avertissement.
-- attendu : stale=stale run_at=2099-01-01 … feed_unchanged=t; conflict=conflict events_delta=0 feed=0;
--           applied=applied last_error=avertissement test
do $$ declare s public.collector_state; v text := ''; ev0 bigint; res text; begin
  select * into s from public.collector_state where id = 1;
  select count(*) into ev0 from public.events;
  res := public.collector_apply('[]','[]', s.last_feed_ts, '2099-01-01', s.last_feed_ts, null);
  v := v || format('stale=%s run_at=%s feed_unchanged=%s; ', res, (select last_run_at from public.collector_state), (select last_feed_ts = s.last_feed_ts from public.collector_state));
  res := public.collector_apply('[{"observed_at":"2099-01-01","service_date":"2099-01-01","trip_id":"T-TEST","kind":"delay","value":{}}]'::jsonb,'[]', s.last_feed_ts + 999, '2099-01-02', s.last_feed_ts - 1, null);
  v := v || format('conflict=%s events_delta=%s feed=%s; ', res, (select count(*) from public.events) - ev0, (select last_feed_ts - s.last_feed_ts from public.collector_state));
  res := public.collector_apply('[]','[]', s.last_feed_ts + 999, '2099-01-03', s.last_feed_ts, 'avertissement test');
  v := v || format('applied=%s last_error=%s', res, (select last_error from public.collector_state));
  raise exception 'ROLLBACK %', v;
end $$;
```
