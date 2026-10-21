-- Instantané quotidien à 04:30 UTC (05:30 ou 06:30 à Paris) : la veille et l'avant-veille sont recalculées.
-- Séparé de 20261022000001 : pg_cron n'existe pas dans le harnais de test PGlite.
select cron.schedule('daily-stats', '30 4 * * *', 'select public.snapshot_recent()');
