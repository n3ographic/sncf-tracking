# Compteur cumulé Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un compteur des indemnités théoriques cumulées depuis le 20 octobre 2026, au-delà du plafond de 31 jours de `stats_period`, avec la couverture toujours affichée.

**Architecture:** Une table `daily_stats` conserve, pour chaque jour de service terminé, la sortie de `stats_period` ; un cron quotidien (re)calcule la veille et l'avant-veille ; `cumul_totals()` additionne côté base ; `GET /api/cumul` en tire un coût calculé à la lecture avec les prix et places de la base ; le tableau de bord, la carte et la méthodologie l'affichent.

**Tech Stack:** PostgreSQL (Supabase, `pg_cron`), PGlite pour les tests SQL, Next.js 15, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-compteur-cumule-design.md`

## Global Constraints

- Observé seulement, aucune extrapolation ; couverture (`observed / planned`) toujours affichée avec le compteur ; estompé sous `SAMPLE_MIN = 30` trains ayant circulé.
- Début de la collecte : jour de service `2026-10-20` ; aucun snapshot avant cette date.
- `daily_stats` : clé `(service_date, brand, axis, metric)`, lecture publique (`anon`) seule, droits d'écriture retirés à `anon` et `authenticated` ; `snapshot_day` et `snapshot_recent` non exécutables par `anon`, `authenticated` ni `public`.
- Les snapshots stockent les décomptes bruts ; le coût en euros se calcule à la lecture : Σ marque (`comp_pct_sum` / 100 × `price_eur_ht` × `seats`) × occupation (0,75, `DEFAULT_OCCUPANCY` de `web/lib/stats.ts`).
- Cron quotidien à 04:30 UTC dans une migration séparée ; toute application sur la production exige l'accord de l'auteur ; les migrations sont additives.
- `GET /api/cumul` : aucun paramètre (400 `no-store` avant toute lecture), cache `public, s-maxage=3600, stale-while-revalidate=600`, clé `['cumul', 'v1']` 3 600 s, 502 `no-store` en cas d'erreur.
- Textes en français ; aucune dépendance neuve ; `/api/stats`, `/api/live`, `/api/rules` inchangés.

## Review Focus

- Jour sans aucun train, ou jour dont aucun train n'est terminé : `snapshot_day` n'écrit rien sans erreur ; `cumul_totals` vide donne un compteur à zéro, pas d'erreur (Tasks 1 et 3).
- Deux appels de `snapshot_day` sur le même jour : mêmes lignes, jamais de doublon ni de double comptage (Task 1).
- Recalcul de l'avant-veille après un retard tardif : le total du jour est mis à jour, pas ajouté (Task 1).
- Aucun prévu (couverture avec `planned = 0`) : `coverage_pct` nul, affiché « — », pas de division par zéro (Tasks 3 et 4).
- `anon` ne peut ni écrire dans `daily_stats` ni exécuter `snapshot_day` (Task 1).
- `/api/cumul` en échec : la carte n'affiche pas de compteur et aucune erreur visible ; le tableau de bord affiche un message (Task 4).

---

### Task 1: Snapshots journaliers et totaux en base

**Files:**
- Create: `supabase/migrations/20261022000001_daily_stats.sql`, `supabase/migrations/20261022000002_daily_stats_cron.sql`
- Modify: `tests/sql/harness.ts` (ajouter `20261022000001_daily_stats.sql` à `MIGRATIONS_UNDER_TEST`, pas la migration du cron)
- Test: `tests/daily-stats.test.ts`

**Interfaces:**
- Consumes: `stats_period(p_from date, p_to date, p_now timestamptz default now())` ; harnais `makeDb`, `resetData`, `seedTrip`, `asAnon` (`tests/sql/harness.ts`) ; modèle de test de `tests/measures.test.ts`.
- Produces:
  - table `public.daily_stats (service_date date, brand text, axis text, metric text, n bigint not null, computed_at timestamptz not null default now(), primary key (service_date, brand, axis, metric))`
  - `public.snapshot_day(p_day date, p_now timestamptz default now()) returns int` — remplace les lignes du jour par la sortie de `stats_period(p_day, p_day, p_now)` en une transaction ; renvoie le nombre de lignes
  - `public.snapshot_recent(p_now timestamptz default now()) returns int` — `snapshot_day` pour la veille et l'avant-veille (jours calendaires à Paris de `p_now`), jamais avant `2026-10-20` ; renvoie le total de lignes
  - `public.cumul_totals() returns table (brand text, metric text, n bigint, days int, first_day date, last_day date)` — somme de `daily_stats` par marque et métrique, `days`, `first_day` et `last_day` sur l'ensemble des jours présents ; `execute` à `anon`
  - le rattrapage : dans la migration, `snapshot_day` pour chaque jour de `2026-10-20` à la veille (Paris)

- [ ] **Step 1: Write the failing tests** dans `tests/daily-stats.test.ts` (même structure que `tests/measures.test.ts`, `NOW = '2026-11-02T12:00:00Z'`, jours de service `2026-11-01` et `2026-10-31` avec arrivée en soirée donc terminés à `NOW`) :
  - `snapshot_day('2026-11-01', NOW)` après `seedTrip` d'un train circulé (retard 2 400 s, INOUI) et d'un train annulé : renvoie un nombre de lignes > 0 ; `daily_stats` contient `planned = 2`, `circulated = 1`, `cancelled = 1` pour ce jour, marque et axe.
  - deux appels successifs : `select count(*) from daily_stats` identique et mêmes valeurs ; modification d'un retard puis nouvel appel : la valeur de `comp_pct_sum` du jour est mise à jour (pas additionnée).
  - jour sans train : renvoie 0 et n'écrit rien ; avec un train non terminé à `p_now` : n'écrit rien pour lui.
  - `snapshot_recent('2026-11-02T12:00:00Z')` : écrit `2026-11-01` et `2026-10-31` et rien d'autre ; `snapshot_recent('2026-10-21T10:00:00Z')` ne touche jamais une date antérieure au `2026-10-20` (ne crée au plus que `2026-10-20`).
  - `cumul_totals()` après snapshots de deux jours : pour chaque `(marque, métrique)`, `n` égale la somme de `stats_period('2026-10-31','2026-11-01', NOW)` sur la même plage (comparer avec une requête directe) ; `days = 2`, `first_day = 2026-10-31`, `last_day = 2026-11-01` ; table vide : zéro ligne.
  - droits : sous `asAnon`, `select count(*) from daily_stats` et `select * from cumul_totals()` réussissent ; `insert`/`update`/`delete` sur `daily_stats` échouent ; `snapshot_day` et `snapshot_recent` échouent (permission refusée).
- [ ] **Step 2: Run** `npx vitest run tests/daily-stats.test.ts` — Expected: FAIL (fonctions absentes).
- [ ] **Step 3: Implement** la migration `20261022000001_daily_stats.sql` : table, RLS (`enable row level security`, politique `anon_read` `for select to anon using (true)`), `revoke insert, update, delete, truncate … from anon, authenticated`, les trois fonctions (`security invoker`, `set search_path = ''` avec noms qualifiés) et `revoke execute on function snapshot_day, snapshot_recent from public, anon, authenticated` ; `cumul_totals` avec `grant execute … to anon` ; rattrapage par une boucle `do $$ … $$` de `2026-10-20` à `(now() at time zone 'Europe/Paris')::date - 1`. La migration `…2_daily_stats_cron.sql` contient seulement `select cron.schedule('daily-stats', '30 4 * * *', 'select public.snapshot_recent()')`.
- [ ] **Step 4: Run** `npx vitest run` (racine) — Expected: tous les tests passent, y compris les anciens SQL ; `npx tsc --noEmit` passe.
- [ ] **Step 5: Commit** — `feat: snapshots journaliers des statistiques et totaux cumulés`

### Task 2: Application en production et contrôle de cohérence

**Files:**
- Create: `docs/findings/2026-10-22-compteur.md`

**Interfaces:**
- Consumes: migrations de la Task 1 ; projet Supabase `jsbwehfkvcasuyynfwga`.
- Produces: `daily_stats` remplie du `2026-10-20` à la veille, `cumul_totals()` disponible en production, cron planifié.

**Arrêt obligatoire : appliquer une migration sur la production demande l'accord de l'auteur ; s'il ne peut pas être obtenu par l'outil, lui fournir le SQL à coller dans l'éditeur Supabase. Demander l'accord avant la Step 1.**

- [ ] **Step 1: Après accord**, appliquer `20261022000001_daily_stats.sql` avec `apply_migration` (nom `daily_stats`) ; vérifier avec `list_tables` et `get_advisors` (sécurité) : aucune alerte ERROR nouvelle ; consigner les autres.
- [ ] **Step 2: Contrôle de cohérence** (`execute_sql`) : `select count(distinct service_date), min(service_date), max(service_date) from daily_stats` (un jour par date de `2026-10-20` à hier) ; pour chaque marque et métrique, `cumul_totals()` égale `stats_period('2026-10-20', hier, now())` à l'unité près (écart toléré uniquement pour les trains terminés entre-temps ; consigner tout écart et son explication) ; `anon` : appel REST `POST /rest/v1/rpc/cumul_totals` répond 200 et `POST /rest/v1/rpc/snapshot_day` est refusé.
- [ ] **Step 3: Après accord**, appliquer `20261022000002_daily_stats_cron.sql` (nom `daily_stats_cron`) ; vérifier `select jobname, schedule, active from cron.job where jobname = 'daily-stats'`. Consigner dans `docs/findings/2026-10-22-compteur.md` les chiffres des Steps 1 à 3 ; à vérifier le lendemain : `cron.job_run_details` montre un passage réussi.
- [ ] **Step 4: Commit** — `docs: compteur cumulé appliqué en production`

### Task 3: Route `/api/cumul`

**Files:**
- Create: `web/lib/cumul.ts`, `web/app/api/cumul/route.ts`
- Modify: `web/lib/handlers.ts` (+ `createCumulHandler`), `README.md` (section API)
- Test: `web/tests/cumul.test.ts`, `web/tests/handlers.test.ts`

**Interfaces:**
- Consumes: `Deps`, `json`, `guarded` (`web/lib/handlers.ts`) ; `unwrap` (`web/lib/db.ts`) ; `Price`, `DEFAULT_OCCUPANCY` (`web/lib/stats.ts`) ; `toNum`, `round` (`web/lib/num.ts`) ; RPC `cumul_totals`.
- Produces:
  - `type CumulRow = { brand: string; metric: string; n: number | string; days: number; first_day: string; last_day: string }`
  - `type CumulBrand = { brand: string; planned: number; observed: number; circulated: number; comp_eligible: number; comp_pct_sum: number; cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number }`
  - `type Cumul = { since: string | null; through: string | null; days: number; planned: number; observed: number; coverage_pct: number | null; circulated: number; comp_eligible: number; cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number; by_brand: CumulBrand[]; assumptions: { occupancy: number; prices: Price[] } }`
  - `shapeCumul(rows: CumulRow[], prices: Price[], occupancy?: number): Cumul` — convertit `n` en nombre (`toNum`), `coverage_pct` = observés / prévus × 100 arrondi à 0,1 (`null` si prévus = 0), coût de chaque marque = `comp_pct_sum / 100 × price_eur_ht × seats` (plein taux) puis × occupation, totaux = somme des marques, `since`/`through` = premier/dernier jour (`null` si aucune ligne), marque sans prix lève une erreur
  - `createCumulHandler(deps: Deps): (req: Request) => Promise<Response>`

- [ ] **Step 1: Write the failing tests.** `cumul.test.ts` (réutiliser `prices` de `web/tests/fixtures.ts`) : deux marques, comptes connus (`planned` 100 et 50, `observed` 40 et 10, `circulated` 38 et 9, `comp_eligible` 5 et 1, `comp_pct_sum` 125 et 25) → couverture 33,3 %, coût INOUI = 125/100 × 46,6 × 556 × 0,75 arrondi à 2 décimales, coût à rames pleines égal au coût divisé par l'occupation, totaux = sommes, `since`/`through` des lignes ; `n` reçu en chaîne (`'40'`) converti ; lignes vides → compteurs à zéro, `coverage_pct: null`, `since: null` ; marque sans prix → erreur ; `n` non numérique → erreur. `handlers.test.ts` : `?x=1` → 400 `no-store` sans appel à `rpc` ni `select` ; succès → 200, en-tête exact, clé `['cumul', 'v1']` et `3600` ; échec de `rpc('cumul_totals')` → 502 `no-store` et rien de mémorisé puis reprise.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/cumul.test.ts tests/handlers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `shapeCumul`, `createCumulHandler` (refus de tout paramètre avant la lecture ; dans `deps.cached(['cumul', 'v1'], 3600, …)` : `rpc('cumul_totals', {})` et `select('reference_prices', …)` en parallèle, `shapeCumul`), la route (mêmes `dynamic` et `preferredRegion` que `/api/rules`) et la section « `GET /api/cumul` » du README (champs, hypothèses, cache, précisions : observé seulement, jamais extrapolé).
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe, `/api/cumul` dans la sortie de build.
- [ ] **Step 5: Commit** — `feat: route /api/cumul`

### Task 4: Affichage du compteur

**Files:**
- Modify: `web/app/tableau/tableau-view.tsx`, `web/app/tableau/tableau.css`, `web/app/carte-view.tsx`, `web/app/carte.css`, `web/app/methodologie/page.tsx`, `README.md`
- Modify: `docs/findings/2026-10-22-compteur.md`

**Interfaces:**
- Consumes: `GET /api/cumul` (Task 3, type `Cumul`), `isSmallSample` (`web/lib/dashboard-model.ts`).
- Produces: bandeau « Depuis le 20 octobre » sur `/tableau`, compteur dans la barre de la carte, paragraphe dans la méthodologie.

- [ ] **Step 1: Implement le bandeau du tableau de bord.** En tête de `/tableau`, hors sélecteur de période : « X € HT d'indemnités théoriques sur N trains observés (couverture : Y % des trains prévus), du D1 au D2 », détail par marque (coût et trains ayant circulé), mention « observé seulement, aucune extrapolation », estompé sous 30 trains ayant circulé (`isSmallSample`) avec « échantillon trop petit », « — » pour une couverture nulle ; chargement et erreur propres (« Compteur indisponible » avec « Réessayer ») sans bloquer le reste de la page ; période sans donnée : « Aucun jour terminé pour le moment ».
- [ ] **Step 2: Implement le compteur de la carte** : un petit élément dans la barre (« Indemnités théoriques cumulées : X € HT », lien vers `/tableau`), chargé une fois au montage ; absent sans message en cas d'échec. **Méthodologie** : paragraphe « Compteur cumulé » (observé seulement, couverture affichée, pas d'extrapolation, calculé jour par jour). README : courte mention.
- [ ] **Step 3: Verify build** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe.
- [ ] **Step 4: Vérifier à la main** (prévisualisation, navigateur intégré, base de production) : le bandeau affiche des chiffres cohérents avec `/api/cumul` ; l'estompage sous 30 trains ; l'erreur simulée (fetch rejeté) du bandeau avec « Réessayer » sans casser le tableau ; le compteur de la carte présent et son lien ; mobile 375 px sans défilement horizontal de la page, mode sombre ; consigner dans `docs/findings/2026-10-22-compteur.md`.
- [ ] **Step 5: Commit** — `feat: compteur cumulé sur le tableau de bord et la carte`

### Task 5: Mise en ligne

**Files:**
- Modify: `docs/findings/2026-10-22-compteur.md`

**Interfaces:**
- Consumes: Tasks 1 à 4 (la migration est déjà appliquée en production à la Task 2).
- Produces: compteur en production sur `https://sncf-tracking.vercel.app`.

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 1.**

- [ ] **Step 1: Après accord**, fusion rapide de la branche dans `main`, `git push origin main`, puis `vercel deploy --prod --yes` depuis la racine du dépôt.
- [ ] **Step 2: Vérifier en production** : `curl -s https://sncf-tracking.vercel.app/api/cumul` renvoie 200 avec les champs du type `Cumul` et des nombres ; `/api/cumul?x=1` renvoie 400 ; `/tableau` et `/` répondent 200 avec le compteur visible dans le navigateur, sans erreur console ; consigner dans les findings, commit et push (après accord) — `docs: vérification du compteur cumulé en production`. Rappel à consigner : le lendemain, vérifier que le cron `daily-stats` a tourné (`cron.job_run_details`).

---

**Plans à part** : export mensuel des circulations (CSV, pipeline et purge), agrégation des causes de retard.
