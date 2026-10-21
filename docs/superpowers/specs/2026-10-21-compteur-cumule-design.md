# Plan 4b : compteur cumulé (design)

Dernier des trois sous-plans du plan 4 (4a tableau de bord et 4c méthodologie livrés).

## Objectif et périmètre

Un compteur des indemnités théoriques cumulées depuis le début de la collecte (service du 20 octobre 2026), au-delà du plafond de 31 jours de `stats_period`, avec la couverture de la collecte toujours affichée.

Hors périmètre : extrapolation aux trains non observés (refusée : biais de sélection), export CSV des circulations, causes de retard.

## Principe de présentation (décision)

**Observé seulement, couverture affichée.** « X € HT d'indemnités théoriques sur N trains observés (couverture : Y % des trains prévus), du 20 octobre au D. » Le compteur sous-estime la réalité tant que la couverture est faible ; aucune extrapolation. Estompé sous 30 trains ayant circulé (même règle que le tableau de bord).

## Base (migration sur la production, avec l'accord de l'auteur)

- Table `public.daily_stats (service_date date, brand text, axis text, metric text, n bigint not null, computed_at timestamptz not null default now(), primary key (service_date, brand, axis, metric))`. RLS activée avec une politique de lecture pour `anon`, droits d'écriture retirés à `anon` et `authenticated` (même schéma que `compensation_scale`).
- `public.snapshot_day(p_day date) returns int` : dans une transaction, supprime les lignes du jour puis insère la sortie de `stats_period(p_day, p_day)` ; renvoie le nombre de lignes. `security invoker`, `execute` retiré à `public`, `anon` et `authenticated` ; réservée au rôle propriétaire (cron).
- `public.snapshot_recent(p_now timestamptz default now()) returns int` : appelle `snapshot_day` pour la veille et l'avant-veille (jours calendaires à Paris de `p_now`), jamais pour un jour antérieur au 2026-10-20. Le recalcul de l'avant-veille rattrape les trains terminés tard ou retirés tard.
- Rattrapage unique dans la migration : `snapshot_day` pour chaque jour du 2026-10-20 à la veille (Paris).
- `public.cumul_totals() returns table (brand text, metric text, n bigint, days int, first_day date, last_day date)` : somme de `daily_stats` par marque et métrique (les métriques `planned`, `observed`, `circulated`, `comp_eligible`, `comp_pct_sum` et les autres), plus le nombre de jours distincts et les bornes. `security invoker`, `execute` accordé à `anon`.
- Planification `pg_cron` quotidienne à 04:30 UTC (`select public.snapshot_recent()`), dans une migration séparée (non chargée par le harnais de test PGlite, comme le cron du collecteur).

## API `GET /api/cumul`

Aucun paramètre (400 `no-store` sinon, avant toute lecture). Réponse : `since`, `through`, `days`, `planned`, `observed`, `coverage_pct` (observés / prévus, `null` si prévus = 0), `circulated`, `comp_eligible`, `cost_eur_ht` (à l'occupation de référence `assumptions.occupancy`), `cost_eur_ht_at_full_occupancy`, `by_brand` (mêmes champs par marque), `assumptions` (prix et places lus dans `reference_prices`, occupation). Coût = Σ marque (`comp_pct_sum` / 100 × prix HT × places) × occupation. Cache : `public, s-maxage=3600, stale-while-revalidate=600`, clé `['cumul', 'v1']`, 3 600 s ; erreur de lecture : `502`, `no-store`, rien de mémorisé.

## Affichage

- `/tableau` : bandeau « Depuis le 20 octobre » en tête, indépendant du sélecteur de période, avec le texte ci-dessus, le détail par marque et la couverture ; estompé sous 30 trains ayant circulé.
- Carte : petit compteur dans la barre (« Indemnités théoriques cumulées : X € HT ») avec lien vers le tableau de bord ; absent si `/api/cumul` échoue (aucune erreur visible).
- Page méthodologie : paragraphe sur le compteur (observé seulement, couverture, pas d'extrapolation).

## Unités

- Migration `supabase/migrations/2026102200000N_daily_stats.sql` (table, fonctions, rattrapage) et migration séparée du cron.
- `web/lib/cumul.ts` (pur, testé) : `shapeCumul(rows, prices, occupancy)`.
- `createCumulHandler` dans `web/lib/handlers.ts`, route `web/app/api/cumul/route.ts`.
- Bandeau dans `web/app/tableau/tableau-view.tsx`, compteur dans `web/app/carte-view.tsx`.

## Tests

- SQL (PGlite) : `snapshot_day` idempotent (deux appels, mêmes lignes), jour sans train, jour avec train circulé et train annulé ; `snapshot_recent` n'écrit pas avant le 2026-10-20 ; `cumul_totals` égale la somme de `stats_period` sur plusieurs jours ; `anon` lit `daily_stats` et `cumul_totals` mais ne peut ni écrire ni exécuter `snapshot_day`.
- Web : `shapeCumul` (couverture avec 0 prévu, coût à l'occupation et à rames pleines, prix absent d'une marque), handler (400 avant lecture, 200 et en-tête de cache, 502 `no-store`, clé de cache), affichage à la main (bureau, mobile, erreur de l'API).
- Après application en production : `cumul_totals()` doit égaler `stats_period(2026-10-20, hier)` marque par marque, et `daily_stats` contenir un jour par date ; au lendemain, vérifier que le cron a tourné (`cron.job_run_details`).
