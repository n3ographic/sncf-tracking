-- À appliquer après le déploiement de collect qui appelle la signature à 6 arguments.
drop function public.collector_apply(jsonb, jsonb, bigint, timestamptz);
