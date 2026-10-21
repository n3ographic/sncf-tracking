# Plan 2 — Mesures et API : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** calculer en base la régularité officielle, la mesure brute et les indemnités théoriques à partir des données collectées, et les servir en JSON, avec un cache de 60 s pour le temps réel, depuis un site Next.js sur Vercel.

**Architecture :** les règles (barèmes, seuils de régularité, prix de référence) sont des tables publiques et sourcées. Les mesures sont des fonctions SQL en lecture seule, que le rôle `anon` peut appeler. Elles sont testées dans vitest avec PGlite (Postgres en mémoire). Le site (`web/`, déployé sur Vercel avec ce dossier comme racine) n'a qu'une fine couche : validation des paramètres, calcul du coût estimé, en-têtes de cache. Il n'utilise jamais la clé service role.

**Tech Stack :** Postgres 17 (Supabase), `@electric-sql/pglite@0.2.17`, Next.js 15.5.x (App Router, route handlers), React 19, TypeScript 5.6.2, vitest 2.1.1, `@supabase/supabase-js@2.45.4`, Vercel Hobby.

**Spec :** `docs/superpowers/specs/2026-10-20-observatoire-tgv-design.md`, en particulier la section « Définitions retenues (plan 2, 2026-10-21) ».

## Global Constraints

- Coût nul : Supabase Free (egress 5 Go par mois) et Vercel Hobby.
- Régularité officielle : à l'heure si retard au terminus **strictement inférieur** à 300 s (durée prévue < 5 400 s), 600 s (de 5 400 à 10 800 s inclus) ou 900 s (au-delà de 10 800 s). Taux = à l'heure / ayant circulé, suppressions exclues du dénominateur.
- Barème INOUI, en secondes de retard, du pourcentage du billet : 1 860 → 25, 7 200 → 50, 10 860 → 75. Barème OUIGO : 3 600 → 25, 7 200 → 50. Les suppressions sont comptées, sans montant.
- Tranches de retard, clés exactes : `0`, `1-4`, `5-14`, `15-29`, `30-59`, `60-119`, `120-179`, `180+` (minutes), plus `cancelled` pour les arrêts supprimés.
- Train terminé : annulé, ou arrivée prévue + max(retard au terminus, 0) + 30 min dépassée. Seuls les trains terminés entrent dans les statistiques.
- `brand` ∈ {`INOUI`, `OUIGO`} et `axis` ∈ {`NORD`, `SUD_EST`, `ATLANTIQUE`, `EST`, `INTERSECTEURS`}, chaînes exactes.
- Prix de référence : base HT ; capacité d'une rame ; occupation = paramètre (0,75 par défaut, hypothèse non sourcée, affichée comme telle).
- Temps réel : `Cache-Control: public, s-maxage=60, stale-while-revalidate=30`. Statistiques : `public, s-maxage=900, stale-while-revalidate=300`. Pas de Supabase Realtime. Une erreur n'est jamais mise en cache (`no-store`).
- Plafond de 31 jours par requête de statistiques.
- Site en lecture seule, sans donnée personnelle ; le site n'embarque que la clé publique (`anon`).
- Commentaires et messages de commit en français, identifiants en anglais. Chaque commit se termine par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Les migrations sont additives : le collecteur en production ne doit pas être touché.

## Review Focus

1. **Retards pile sur un seuil** (299/300 s, 5 399/5 400 s de durée, 1 799/1 800/1 860 s, 3 599/3 600 s) : la même valeur doit toujours donner le même résultat dans la régularité, la tranche et l'indemnité. Tests Tasks 1-2.
2. **Période sans aucun train** (jour sans collecte, futur) : réponse 200 avec des zéros et `null` pour les taux, jamais `NaN` ni erreur 500. Test Task 4.
3. **Train à cheval sur minuit** : rattaché au jour de service de son départ, terminé d'après son heure d'arrivée. Test Task 2.
4. **Paramètres hostiles ou absurdes** (dates invalides, `from` > `to`, 10 ans de plage, `occupancy=abc` ou 5) : 400 avant tout appel à la base. Test Task 4.
5. **Supabase en panne ou fonction en erreur** : 502 en `no-store`, jamais un 200 vide mis en cache 60 s qui masquerait la panne. Test Task 4.

---

### Task 1: Harnais de test SQL et règles de mesure

**Files:**
- Create: `tests/sql/harness.ts`, `tests/measure-rules.test.ts`
- Create: `supabase/migrations/20261021000001_measure_rules.sql`
- Create: `docs/findings/2026-10-21-baremes.md`
- Modify: `package.json` (devDependency `@electric-sql/pglite@0.2.17`)

**Interfaces:**
- Produces (`tests/sql/harness.ts`) :
  - `makeDb(): Promise<PGlite>` : base vierge avec les rôles `anon`, `authenticated`, `service_role`, les privilèges par défaut de Supabase (`grant all` sur les tables et fonctions à ces rôles), puis les migrations de `MIGRATIONS_UNDER_TEST` appliquées dans l'ordre, sans les lignes `create extension`.
  - `MIGRATIONS_UNDER_TEST: string[]` : `20261020000001_schema.sql`, `20261020000006_planned_removed.sql`, puis les trois migrations de ce plan (celles qui n'existent pas encore sont ignorées).
  - `type SeedTrip = { serviceDate: string; tripId: string; brand: 'INOUI'|'OUIGO'; axis: Axis; trainNumber: string; dep: string; arr: string; removedAt?: string; circulation?: { cancelled?: boolean; terminusDelayS: number | null; stopDelays?: Record<string, number | 'cancelled'>; cause?: string; lastSeenAt?: string }; stops?: { seq: number; stopId: string; name: string; lat: number; lon: number; arr: string; dep: string }[] }`
  - `seedTrip(db: PGlite, t: SeedTrip): Promise<void>` : insère `trips_planned`, `stop_times_planned` et `stops` si fournis, et `circulations` si `circulation` est fourni (`arr_planned` = `arr`).
  - `asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T>` : exécute avec `set role anon`, puis remet le rôle.
- Produces (SQL) : tables `public.compensation_scale(brand, from_s, pct, source_url, source_as_of, note)`, `public.regularity_rule(duration_from_s, max_delay_exclusive_s, source_url)`, `public.reference_prices(brand, price_eur_ht, seats, price_source, seats_source, as_of)`, toutes en lecture publique ; politique `anon_read` ajoutée sur `stop_times_planned`.

- [ ] **Step 1 : harnais.** Installer PGlite et écrire `tests/sql/harness.ts`. Vérifier d'abord, par un test jetable, que les migrations `0001` et `0006` s'appliquent et que `select (timestamptz '2026-11-01 23:30+00' at time zone 'Europe/Paris')::date` donne `2026-11-02`. **Si PGlite ne charge pas le schéma ou n'a pas les fuseaux horaires et que la correction dépasse une heure, s'arrêter avec le statut BLOCKED** : le contrôleur tranchera pour des tests SQL annulés dans une transaction via le MCP Supabase.
- [ ] **Step 2 : écrire les tests qui échouent** dans `tests/measure-rules.test.ts` :
```ts
test('barème INOUI et OUIGO (secondes de retard)', async () => {
  const { rows } = await db.query('select brand, from_s, pct from compensation_scale order by brand, from_s')
  expect(rows).toEqual([
    { brand: 'INOUI', from_s: 1860, pct: 25 }, { brand: 'INOUI', from_s: 7200, pct: 50 },
    { brand: 'INOUI', from_s: 10860, pct: 75 },
    { brand: 'OUIGO', from_s: 3600, pct: 25 }, { brand: 'OUIGO', from_s: 7200, pct: 50 }])
})
test('règle de régularité officielle', async () => {
  const { rows } = await db.query('select duration_from_s, max_delay_exclusive_s from regularity_rule order by 1')
  expect(rows).toEqual([{ duration_from_s: 0, max_delay_exclusive_s: 300 },
    { duration_from_s: 5400, max_delay_exclusive_s: 600 }, { duration_from_s: 10801, max_delay_exclusive_s: 900 }])
})
test('prix de référence HT et capacité', async () => { /* INOUI 46.60 / 556, OUIGO 34.20 / 634 */ })
test('chaque règle porte sa source', async () => { /* aucune source_url / price_source / seats_source vide */ })
test('anon lit les règles et stop_times_planned, pas events ni collector_state', async () => {
  /* en superuser : insérer 1 ligne dans events et collector_state ; asAnon : count règles > 0, count stop_times_planned lisible,
     count(*) from events = 0 et collector_state = 0 (RLS sans politique) */
})
test('anon ne peut ni écrire dans les règles ni dans circulations', async () => { /* asAnon : insert → rejects (RLS) */ })
```
- [ ] **Step 3 : lancer** `npx vitest run tests/measure-rules.test.ts`. Attendu : FAIL (tables absentes).
- [ ] **Step 4 : écrire la migration** `20261021000001_measure_rules.sql` avec les trois tables, les contraintes `check` sur `brand`, les valeurs de départ (barème, seuils, prix de référence), RLS activée et politiques `anon_read` (lecture seule) sur les trois tables et sur `stop_times_planned`. Les `source_url` du barème sont les deux pages SNCF Voyageurs de la spec (dates `2026-06-17` et `2026-09-04`), celle de la régularité est la page data.gouv.fr de la spec.
- [ ] **Step 5 : vérifier les sources.** Dans le navigateur intégré, relire les deux pages SNCF Voyageurs et le PDF FNAUT `https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf` (et `https://www.fnaut.fr/uploads/2026/02/CP-Chiffres-cles-TGV-2017-2024.pdf`). Confirmer 46,60 € et 34,20 € (2023, HT), 556 et 634 places. Si une valeur diffère, utiliser celle du document, mettre à jour la migration et le test dans le même commit. Rédiger `docs/findings/2026-10-21-baremes.md` (en français, quelques lignes, sans recopier les pages) : pour chaque valeur, source, date de lecture et lecture retenue des bornes.
- [ ] **Step 6 : lancer** `npm test`. Attendu : PASS, sortie sans avertissement.
- [ ] **Step 7 : commit** — `feat: règles de mesure publiques (barèmes, régularité, prix) et harnais SQL`

### Task 2: Fonctions de mesure SQL

**Files:**
- Create: `supabase/migrations/20261021000002_measures.sql`
- Test: `tests/measures.test.ts`

**Interfaces:**
- Consumes : `makeDb`, `seedTrip`, `asAnon`, `SeedTrip` (Task 1) ; tables de la Task 1.
- Produces (SQL, toutes en lecture seule, `security invoker`, `grant execute` à `anon`) :
  - `public.finished_margin() returns interval` : 30 minutes.
  - `public.delay_bucket(p_delay_s int) returns text` : une des huit clés de tranche, immuable.
  - `public.compensation_pct(p_brand text, p_delay_s int) returns int` : pourcentage du barème, 0 hors barème ou marque inconnue.
  - `public.regularity_max_delay_s(p_duration_s int) returns int`.
  - vue `public.circulation_measures` (`with (security_invoker = true)`) : colonnes `service_date, trip_id, brand, axis, train_number, cancelled, duration_s, arr_planned, terminus_delay_s, finished, on_time_official, bucket, comp_pct`. Jointure avec `trips_planned` sur `(service_date, trip_id)`.
  - `public.stats_period(p_from date, p_to date, p_now timestamptz default now()) returns table (brand text, axis text, metric text, n bigint)` : lignes additives par marque et axe. Métriques, noms exacts : `planned`, `observed`, `removed_late`, `never_observed`, `cancelled`, `no_terminus`, `circulated`, `on_time_official`, `comp_eligible`, `comp_pct_sum`, `terminus:<tranche>`, `stop:<tranche>`, `stop:cancelled`.

Définitions de `stats_period` (par jour de service entre `p_from` et `p_to`, inclus) :
- Ensemble `T` : lignes de `trips_planned` dont la circulation est terminée, ou, sans circulation, dont `arr_planned + finished_margin() < p_now`.
- `planned` = |T| ; `observed` = lignes de `T` avec circulation ; `removed_late` = sans circulation et `removed_at` non nul ; `never_observed` = sans circulation et `removed_at` nul. Identité : `planned = observed + removed_late + never_observed`.
- `cancelled`, `no_terminus` (non annulé, retard au terminus nul), `circulated` (non annulé, retard au terminus connu) : `observed = cancelled + no_terminus + circulated`.
- `on_time_official`, `comp_eligible` (pourcentage > 0), `comp_pct_sum` et `terminus:*` portent sur `circulated`. `stop:*` : un décompte par valeur de `stop_delays` des circulations terminées, `stop:cancelled` pour les arrêts supprimés.

- [ ] **Step 1 : écrire les tests qui échouent** dans `tests/measures.test.ts` (chaque test repart d'une base vide ; `p_now = '2026-11-02T12:00:00Z'`) :
```ts
test('delay_bucket aux bornes', async () => {
  const d = [0, 60, 240, 300, 840, 900, 1740, 1800, 3540, 3600, 7140, 7200, 10740, 10800]
  expect(await buckets(db, d)).toEqual(['0','1-4','1-4','5-14','5-14','15-29','15-29','30-59','30-59','60-119','60-119','120-179','120-179','180+'])
})
test('compensation_pct aux bornes', async () => {
  expect(await pcts(db, 'INOUI', [1800, 1860, 7140, 7200, 10800, 10860])).toEqual([0, 25, 25, 50, 50, 75])
  expect(await pcts(db, 'OUIGO', [3540, 3600, 7140, 7200])).toEqual([0, 25, 25, 50])
  expect(await pcts(db, 'TER', [7200])).toEqual([0])
})
test('regularity_max_delay_s aux bornes', async () => {
  expect(await maxDelays(db, [5399, 5400, 10800, 10801])).toEqual([300, 600, 600, 900])
})
```
Jeu de données du test `stats_period('2026-11-01','2026-11-02', p_now)` (INOUI, `SUD_EST`, jour de service `2026-11-01`, arrivées le soir du 1er) :

| train | durée prévue | retard terminus | rôle attendu |
|---|---|---|---|
| A | 3 600 s | 240 | à l'heure, tranche `1-4` ; arrêts `{"1":0,"2":240}` |
| B | 3 600 s | 300 | pas à l'heure (300 n'est pas < 300), tranche `5-14` ; arrêts `{"1":300}` |
| C | 7 200 s | 540 | à l'heure (< 600), tranche `5-14` |
| D | 14 400 s | 900 | pas à l'heure (900 n'est pas < 900), tranche `15-29` |
| E | 3 600 s | annulé | `cancelled` ; arrêts `{"1":"cancelled","2":"cancelled"}` |
| F | 3 600 s | null, non annulé | `no_terminus` |
| G | 7 200 s | 7 200 | tranche `120-179`, 50 % |
| H | planifié, `removed_at` non nul, sans circulation | | `removed_late` |
| I | planifié, sans circulation | | `never_observed` |
| J | jour de service `2026-11-02`, arrivée prévue à 11:50Z, retard 0 | | non terminé : absent de tout |

Et un train OUIGO `ATLANTIQUE` K (durée 7 200 s, retard 3 300 s) : tranche `30-59`, 0 % (le barème OUIGO commence à 3 600 s).
```ts
test('métriques INOUI SUD_EST', async () => {
  expect(metrics(rows, 'INOUI', 'SUD_EST')).toMatchObject({
    planned: 9, observed: 7, removed_late: 1, never_observed: 1, cancelled: 1, no_terminus: 1,
    circulated: 5, on_time_official: 2, comp_eligible: 1, comp_pct_sum: 50,
    'terminus:1-4': 1, 'terminus:5-14': 2, 'terminus:15-29': 1, 'terminus:120-179': 1,
    'stop:0': 1, 'stop:1-4': 1, 'stop:5-14': 1, 'stop:cancelled': 2 })
})
test('métriques OUIGO ATLANTIQUE : barème propre à la marque', async () => {
  expect(metrics(rows, 'OUIGO', 'ATLANTIQUE')).toMatchObject({ planned: 1, observed: 1, circulated: 1,
    on_time_official: 0, comp_eligible: 0, comp_pct_sum: 0, 'terminus:30-59': 1 })
})
test('identités : planned = observed + removed_late + never_observed ; observed = cancelled + no_terminus + circulated ; somme des terminus:* = circulated')
test('train à cheval sur minuit : rattaché au jour de service du départ', async () => {
  /* départ 23:30 Paris le 2026-11-01, arrivée 01:10 Paris le 02 (00:10Z, heure d'hiver), retard 0 :
     inclus par stats_period('2026-11-01','2026-11-01'), absent de ('2026-11-02','2026-11-02'), compté à l'heure (durée 6 000 s → seuil 600) */
})
test('période sans train : aucune ligne, pas d’erreur', async () => { /* stats_period('2030-01-01','2030-01-02') → [] */ })
test('anon peut appeler stats_period', async () => { /* asAnon → même résultat que le superuser */ })
```
- [ ] **Step 2 : lancer** `npx vitest run tests/measures.test.ts`. Attendu : FAIL (fonctions absentes).
- [ ] **Step 3 : écrire la migration** `20261021000002_measures.sql` : les trois fonctions de règle (lisent `compensation_scale` et `regularity_rule` : le plus grand `from_s` / `duration_from_s` inférieur ou égal), la vue et `stats_period`. `stats_period` utilise `jsonb_each` sur `stop_delays` ; les tranches viennent uniquement de `delay_bucket`, la marge uniquement de `finished_margin()`. `grant execute` à `anon` sur les cinq fonctions.
- [ ] **Step 4 : lancer** `npm test`. Attendu : PASS.
- [ ] **Step 5 : commit** — `feat: mesures SQL (régularité officielle, mesure brute, indemnités théoriques)`

### Task 3: Trains en circulation

**Files:**
- Create: `supabase/migrations/20261021000003_live_trains.sql`
- Test: `tests/live.test.ts`

**Interfaces:**
- Consumes : `makeDb`, `seedTrip`, `asAnon` (Task 1) ; `compensation_pct`, `finished_margin` (Task 2) ; tables `stops`, `stop_times_planned`.
- Produces : `public.live_trains(p_now timestamptz default now()) returns jsonb` : tableau JSON de trains (`[]` s'il n'y en a pas), `security invoker`, `grant execute` à `anon`. Un train y figure si sa circulation existe et que `p_now < arr_planned + max(retard au terminus, 0) s + finished_margin()` (annulés compris, jusqu'à la fin de cette fenêtre). Forme d'un train, clés exactes :
  `trip_id`, `service_date`, `brand`, `axis`, `train_number`, `cancelled`, `dep_planned`, `arr_planned`, `origin` et `dest` (`{stop_id, name}`), `delay_s` (retard du dernier arrêt portant un retard numérique, ou `null`), `last_seq` (son `stop_sequence`, ou `null`), `cause`, `comp_pct` (de `compensation_pct(brand, delay_s)`, 0 si `delay_s` nul), `last_seen_at`, `stops` : tableau trié par `stop_sequence` d'objets `{seq, stop_id, name, lat, lon, arr, dep, delay_s, cancelled}` (`delay_s` `null` si inconnu).

- [ ] **Step 1 : écrire les tests qui échouent** (`p_now = '2026-11-02T12:00:00Z'`) :
```ts
test('un train en cours : clés exactes, arrêts triés, retard du dernier arrêt connu', async () => {
  /* 3 arrêts (seq 1, 2, 3), stop_delays {"1":0,"2":420}, arrivée prévue 12:30Z → un train,
     delay_s = 420, last_seq = 2, stops[0].seq < stops[1].seq < stops[2].seq, stops[2].delay_s = null,
     comp_pct = 0, Object.keys(train) égal à la liste exacte de l'interface */
})
test('retard au-delà du seuil : comp_pct selon la marque', async () => { /* INOUI 1 860 → 25 ; OUIGO 1 860 → 0 */ })
test('un train annulé reste visible jusqu’à la fin de sa fenêtre', async () => { /* cancelled=true → présent, stops[i].cancelled */ })
test('un train terminé est absent', async () => { /* arrivée prévue 10:00Z, retard 0 → absent à 12:00Z */ })
test('un retard au terminus prolonge la fenêtre', async () => {
  /* arrivée prévue 11:00Z : avec retard au terminus 0 la fenêtre se ferme à 11:30Z → absent à 12:00Z ;
     avec retard 1 860 s elle se ferme à 12:01Z → présent à 12:00Z */
})
test('aucun train : tableau vide', async () => { expect(result).toEqual([]) })
test('anon peut lire stop_times_planned via la fonction', async () => { /* asAnon → même résultat */ })
```
- [ ] **Step 2 : lancer** `npx vitest run tests/live.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `live_trains` dans `20261021000003_live_trains.sql` (agrégation `jsonb_agg` des trains, `stops` en sous-agrégation ordonnée).
- [ ] **Step 4 : lancer** `npm test`. Attendu : PASS.
- [ ] **Step 5 : commit** — `feat: fonction SQL des trains en circulation`

### Task 4: Application Next.js et routes d'API

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/vitest.config.ts`
- Create: `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/api/live/route.ts`, `web/app/api/stats/route.ts`
- Create: `web/lib/params.ts`, `web/lib/stats.ts`, `web/lib/live.ts`, `web/lib/handlers.ts`, `web/lib/supabase.ts`
- Test: `web/tests/params.test.ts`, `web/tests/stats.test.ts`, `web/tests/live.test.ts`, `web/tests/handlers.test.ts`
- Modify: `.gitignore` (`web/.next/`, `web/.env*`, `.vercel/`)

**Interfaces:**
- Consumes (SQL) : `stats_period(p_from date, p_to date)` et `live_trains()` appelés par `rpc`, tables `reference_prices` et `compensation_scale` lues par `select`.
- Produces (`web/lib/params.ts`) : `parseStatsParams(q: URLSearchParams, now: Date): { ok: true; from: string; to: string; occupancy: number } | { ok: false; error: string }`. Valeurs par défaut : `to` = veille (date de Paris), `from` = `to` − 6 jours, `occupancy` = 0,75. Erreur si date invalide ou impossible, `from` > `to`, plus de 31 jours inclus, `occupancy` non numérique ou hors de [0, 1].
- Produces (`web/lib/stats.ts`) :
  - `type StatRow = { brand: string; axis: string; metric: string; n: number }`, `type Price = { brand: string; price_eur_ht: number; seats: number; price_source: string; seats_source: string; as_of: string }`, `type Scale = { brand: string; from_s: number; pct: number; source_url: string; source_as_of: string }`.
  - `shapeStats(rows: StatRow[], prices: Price[], scale: Scale[], p: { from: string; to: string; occupancy: number }): StatsPayload`. `StatsPayload` = `{ from, to, groups: Group[], totals: Totals, assumptions: { occupancy, prices, compensation_scale } }`. `Group` = `{ brand, axis, ...Totals }`. `Totals` = `{ planned, observed, removed_late, never_observed, cancelled, no_terminus, circulated, on_time_official, official_regularity_pct: number | null, comp_eligible, comp_pct_sum, terminus_buckets: Record<string, number>, stop_buckets: Record<string, number>, estimated_cost_eur_ht: number }`. `official_regularity_pct` = `on_time_official / circulated` en pourcentage à une décimale, `null` si `circulated` vaut 0. Coût d'un groupe = `comp_pct_sum / 100 × price_eur_ht × seats × occupancy` (prix de sa marque), les totaux sont les sommes des groupes.
- Produces (`web/lib/live.ts`) : `shapeLive(trains: LiveTrain[], prices: Price[], now: Date): { generated_at: string; trains: (LiveTrain & { comp_eur_per_passenger_ref: number })[] }` ; `comp_eur_per_passenger_ref` = `comp_pct / 100 × prix de la marque`, arrondi à 2 décimales.
- Produces (`web/lib/handlers.ts`) : `createStatsHandler(deps: { rpc, select, now: () => Date }): (req: Request) => Promise<Response>` et `createLiveHandler(deps)` ; 200 avec `Cache-Control: public, s-maxage=900, stale-while-revalidate=300` (statistiques) ou `public, s-maxage=60, stale-while-revalidate=30` (temps réel) ; 400 pour des paramètres invalides ; 502 si la base répond en erreur ; ces deux cas avec `Cache-Control: no-store`. Les routes `app/api/*/route.ts` n'exportent que `GET` et `dynamic = 'force-dynamic'`, en branchant les handlers sur le client de `lib/supabase.ts` (URL et clé publique lues dans `SUPABASE_URL` et `SUPABASE_ANON_KEY`).

- [ ] **Step 1 : initialiser `web/`** avec `package.json` autonome (`next@15.5.4`, `react@19.1.0`, `react-dom@19.1.0`, `@supabase/supabase-js@2.45.4`, `typescript@5.6.2`, `vitest@2.1.1`, `@types/*` nécessaires ; si une version n'existe pas, prendre la 15.5.x ou 19.1.x la plus récente et la noter dans le compte rendu), les scripts `dev`, `build`, `test`, et une page `app/page.tsx` minimale en français (« Observatoire en construction », mention « non affilié à SNCF ni à OUIGO »). Le test racine `npm test` ne doit pas ramasser `web/` (le `vitest.config.ts` racine n'inclut que `tests/`) et `npx tsc -p .` à la racine ne doit pas parcourir `web/` (l'exclure du `tsconfig.json` racine si besoin).
- [ ] **Step 2 : écrire les tests qui échouent** :
```ts
// params.test.ts
test('valeurs par défaut : veille de Paris, 7 jours, occupation 0,75', () => {
  const r = parseStatsParams(new URLSearchParams(), new Date('2026-11-01T23:30:00Z')) // déjà le 2 novembre à Paris
  expect(r).toEqual({ ok: true, from: '2026-10-26', to: '2026-11-01', occupancy: 0.75 })
})
test.each([
  ['from=2026-13-01&to=2026-11-01'], ['from=2026-11-05&to=2026-11-01'],
  ['from=2026-09-01&to=2026-11-01'], ['from=2016-01-01&to=2026-11-01'],
  ['occupancy=abc'], ['occupancy=5'], ['occupancy=-0.1'], ['from=2026-10-01&to=2026-11-01'] /* 32 jours */,
])('refuse %s', (qs) => expect(parseStatsParams(new URLSearchParams(qs), now).ok).toBe(false))
test('31 jours inclus acceptés', () => { /* from=2026-10-02&to=2026-11-01 → ok */ })

// stats.test.ts
test('régularité, coût et totaux', () => {
  /* rows INOUI SUD_EST : circulated 5, on_time_official 2, comp_pct_sum 50, observed 7 ; prix INOUI 46.6 × 556 ; occupation 0,75
     → official_regularity_pct = 40, estimated_cost_eur_ht ≈ 9716.1 (toBeCloseTo, 2) */
})
test('deux groupes : les totaux additionnent, chaque marque utilise son prix', () => { /* INOUI + OUIGO */ })
test('période vide : zéros, null, pas de NaN', () => {
  const p = shapeStats([], prices, scale, params)
  expect(p.groups).toEqual([]); expect(p.totals.official_regularity_pct).toBeNull()
  expect(JSON.stringify(p)).not.toContain('NaN'); expect(p.totals.estimated_cost_eur_ht).toBe(0)
})
test('les tranches absentes valent 0 et toutes les clés sont présentes', () => { /* 8 clés dans terminus_buckets, 9 dans stop_buckets */ })

// live.test.ts
test('indemnité de référence par voyageur', () => { /* comp_pct 50, prix 46.6 → 23.3 ; comp_pct 0 → 0 */ })

// handlers.test.ts
test('succès : 200, JSON et Cache-Control exact (stats et temps réel)')
test('paramètres invalides : 400, no-store, la base n’est pas appelée')
test('la base répond en erreur : 502, no-store, pas de corps trompeur')
test('la base lève une exception : 502, no-store')
```
- [ ] **Step 3 : lancer** `cd web && npm install && npx vitest run`. Attendu : FAIL (modules absents).
- [ ] **Step 4 : implémenter** `params.ts`, `stats.ts`, `live.ts`, `handlers.ts`, `supabase.ts` et les deux routes. Les dates de Paris se calculent avec `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })`.
- [ ] **Step 5 : lancer** `cd web && npx vitest run && npx tsc --noEmit && npx next build`. Attendu : tests PASS, types propres, build réussi.
- [ ] **Step 6 : commit** — `feat: application Next.js et routes /api/stats et /api/live avec cache`

### Task 5: Migrations en production et vérification sur les vraies données

**Files:**
- Create: `docs/findings/2026-10-21-mesures-reelles.md`
- Create: `web/.env.local` (git-ignoré : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, la clé publique lue avec l'outil `get_publishable_keys`)

**Interfaces:**
- Consumes : les trois migrations (Tasks 1-3), les routes (Task 4), le projet Supabase `jsbwehfkvcasuyynfwga`.
- Produces : base de production à jour ; compte rendu chiffré.

- [ ] **Step 1 : appliquer** les trois migrations avec `apply_migration` (noms `measure_rules`, `measures`, `live_trains`), dans l'ordre. Vérifier avec `list_tables` et `get_advisors` (sécurité) : aucune alerte de niveau ERROR nouvelle ; consigner les autres.
- [ ] **Step 2 : accès `anon` réel** avec `curl` et la clé publique : `POST /rest/v1/rpc/stats_period` (corps `{"p_from":"2026-10-20","p_to":"2026-10-21"}`) et `POST /rest/v1/rpc/live_trains` répondent 200 ; `GET /rest/v1/stop_times_planned?limit=1` répond 200 ; `GET /rest/v1/events?limit=1` renvoie `[]` ; `POST /rest/v1/compensation_scale` est refusé.
- [ ] **Step 3 : cohérence** : pour `2026-10-20` et `2026-10-21`, comparer `stats_period` aux comptes directs sur `circulations` (observées, annulées, sans terminus) et vérifier les identités du plan (`planned = observed + removed_late + never_observed`, etc.). Consigner les chiffres.
- [ ] **Step 4 : performance et taille** : chronométrer `stats_period` sur la plage des jours disponibles (`explain analyze`, la limite du rôle `anon` est 3 s), mesurer la taille en octets de `live_trains()` et du JSON de `/api/live` en local (`npx next dev` dans `web/`, `curl -s localhost:3000/api/live | wc -c`). Budget : `/api/live` ≤ 120 Ko ; sinon le noter comme point à traiter avant la carte (le plafond d'egress de Supabase est de 5 Go par mois).
- [ ] **Step 5 : routes en local** : `curl` de `/api/stats` (défaut), `/api/stats?from=2026-10-20&to=2026-10-21`, `/api/stats?occupancy=7` (attendu 400), `/api/live`. Joindre un extrait de chaque réponse au compte rendu et vérifier la régularité officielle obtenue (ordre de grandeur plausible, taux entre 0 et 100).
- [ ] **Step 6 : rédiger** `docs/findings/2026-10-21-mesures-reelles.md` (chiffres des étapes 3 à 5, avertissements des advisors) et commiter — `docs: vérification des mesures sur les données réelles`

### Task 6: Déploiement Vercel et vérification du cache

**Files:**
- Modify: `README.md` (section API : routes, paramètres, hypothèses, cache), `docs/findings/2026-10-21-mesures-reelles.md` (résultats du cache)

**Interfaces:**
- Consumes : branche prête (Tasks 1-5).
- Produces : site déployé sur `*.vercel.app` servant `/api/live` et `/api/stats`.

**Arrêt obligatoire : tout ce qui suit publie ou pousse. Demander l'accord de l'auteur avant la Step 1, et ne rien pousser sans lui.**

- [ ] **Step 1 : fusionner et pousser.** Après accord : fusion rapide de la branche dans `main`, `git push` via l'URL `ssh://git@github.com/n3ographic/sncf-tracking.git` (la configuration git globale réécrit `git@github.com:` en HTTPS).
- [ ] **Step 2 : projet Vercel.** Essayer d'abord l'outil MCP Vercel `create_git_project` (dépôt `n3ographic/sncf-tracking`, répertoire racine `web`, framework Next.js) puis `create_project_env` pour `SUPABASE_URL` et `SUPABASE_ANON_KEY` (la clé publique, jamais la clé service role). Si l'outil est refusé ou si l'intégration GitHub manque, demander à l'auteur de l'importer dans le tableau de bord Vercel avec ces réglages.
- [ ] **Step 3 : vérifier le déploiement** : état `READY`, puis `curl -si https://<url>/api/live` deux fois à moins de 60 s d'écart. Attendu : les deux `generated_at` identiques et `x-vercel-cache: HIT` à la seconde requête ; après plus de 90 s, un `generated_at` plus récent. `curl -si '<url>/api/stats?occupancy=9'` : 400 et `cache-control: no-store`. `curl -s <url>/api/stats | head -c 600` : JSON conforme à l'interface de la Task 4.
- [ ] **Step 4 : vérifier l'egress** : relever la taille de `/api/live` en production et estimer le volume mensuel (taille × 1 440 × 30) ; consigner le résultat et l'alerte si > 2 Go.
- [ ] **Step 5 : documenter** dans le README les deux routes, leurs paramètres, les hypothèses (prix HT, une rame, occupation 0,75 non sourcée) et le cache ; consigner dans `docs/findings/2026-10-21-mesures-reelles.md` les résultats des étapes 3 et 4.
- [ ] **Step 6 : commit et push** (après accord, comme la Step 1) — `docs: API publique et vérification du cache Vercel`

---

**Plans suivants** : plan 3 (carte MapLibre, tracés SNCF Réseau, positions estimées à partir de `/api/live`) ; plan 4 (tableau de bord, compteur cumulé, page méthodologie affichant les règles lues dans les tables, comparaison avec la régularité officielle mensuelle une fois un mois complet disponible). **Le compteur cumulé depuis le début de la collecte dépasse le plafond de 31 jours de `stats_period` : le plan 4 devra ajouter une table de cumuls journaliers (un calcul par jour terminé) plutôt que relever ce plafond.**
