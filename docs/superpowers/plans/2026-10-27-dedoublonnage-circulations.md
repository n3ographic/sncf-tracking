# Dédoublonnage des circulations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compter chaque train une seule fois par `(service_date, train_number)` dans `circulation_measures`, `stats_period` et `live_trains`, puis recalculer l'historique.

**Architecture:** Une migration crée deux vues canoniques (`canonical_trips`, `canonical_circulations`) et remplace la vue `circulation_measures` et les fonctions `stats_period` et `live_trains` pour qu'elles les lisent ; elle rejoue `snapshot_day` sur l'historique. Aucune ligne n'est modifiée ni supprimée ; l'API et l'écran ne changent pas de forme.

**Tech Stack:** PostgreSQL (Supabase), tests Vitest sur PGlite (`tests/sql/harness.ts`), Next.js pour la méthodologie.

**Spec:** `docs/superpowers/specs/2026-10-27-dedoublonnage-circulations-design.md`

## Global Constraints

- Branche `dedoublonnage` (contient la spec). Pas de push ; fusion après accord. Production : migration, puis code, puis vérification, chacune après accord explicite.
- Fichier de migration unique : `supabase/migrations/20261028000001_canonical_trains.sql`, ajouté en dernier à `MIGRATIONS_UNDER_TEST`.
- Clé d'un train : `(service_date, train_number)`.
- `canonical_trips` : préférer `removed_at is null`, puis `last_import_at` le plus récent (nuls en dernier), puis `trip_id` le plus petit.
- `canonical_circulations` : préférer `last_seen_at` le plus récent (nuls en dernier), puis `trip_id` le plus petit.
- Vues en `security_invoker = true`, `grant select … to anon`.
- `circulation_measures`, `stats_period`, `live_trains` : mêmes colonnes et même forme de sortie qu'avant ; aucune clé de cache ne change.
- Interdit : `delete`/`update` sur `circulations` ou `trips_planned` ; toucher au collecteur, à `import:static`, à `build:traces`, à `data/`.
- Tests : racine `npx vitest run` ; web `cd web && npx vitest run && npx tsc --noEmit`.

## Review Focus

- Deux copies d'un même train dont l'une est annulée et l'autre non : la copie vue en dernier décide (test tâche 1).
- Un numéro présent deux jours de suite : deux trains, jamais fusionnés (test tâche 1).
- Toutes les variantes d'un numéro retirées (train réellement supprimé) : il reste compté une fois en `planned` et en `removed_late` (test tâche 1).
- Une circulation sans `last_seen_at` à côté d'une autre datée : la datée l'emporte (test tâche 1).
- `anon` lit `stats_period` et `live_trains` à travers les nouvelles vues sans erreur de droits (test tâche 1 et tâche 2).

---

### Task 1: Vues canoniques, `circulation_measures` et `stats_period`

**Files:**
- Create: `supabase/migrations/20261028000001_canonical_trains.sql`
- Modify: `tests/sql/harness.ts` (`MIGRATIONS_UNDER_TEST`)
- Create: `tests/canonical-trains.test.ts`

**Interfaces:**
- Produces : vues `public.canonical_trips` (colonnes de `trips_planned`) et `public.canonical_circulations` (colonnes de `circulations`) ; `circulation_measures` et `stats_period(p_from date, p_to date, p_now timestamptz)` inchangées en sortie ; index `trips_planned (service_date, train_number)` et `circulations (service_date, train_number)`.

- [ ] **Step 1: Tests qui échouent** dans `tests/canonical-trains.test.ts`, même mise en place que `tests/range-measures.test.ts` (`makeDb`, `resetData`, `seedTrip`, `NOW = '2026-11-02T12:00:00Z'`, trains du `2026-11-01`, INOUI SUD_EST, départ `17:00Z`, arrivée `20:00Z`, helper `stats()` qui somme `stats_period('2026-11-01','2026-11-01',NOW)` par métrique) :
  - `deux variantes d'un même numéro : un seul train, retard et indemnité de la copie vue en dernier` : trajet `A:20270114` (retiré : `removedAt` renseigné ; circulation 1 900 s, `lastSeenAt` `2026-11-01T09:30:00Z`) et `A:20270115` (présent ; circulation 7 300 s, `lastSeenAt` `2026-11-01T21:00:00Z`), même `trainNumber` `A`. Attendu : `planned 1, observed 1, removed_late 0, circulated 1, comp_eligible 1, comp_pct_sum 50, 'terminus:120-179': 1`, `'cause:sans_cause': 1`, `'cause_delay_s:sans_cause': 7300`, et aucune clé `terminus:30-59`.
  - `circulation_measures : une ligne par numéro` : même jeu ; `select count(*) from circulation_measures where train_number = 'A'` vaut 1 et sa ligne a `trip_id = 'A:20270115'`.
  - `copie annulée vue en dernier : le train compte comme annulé` : `B:1` circulation 1 200 s `lastSeenAt 10:00Z`, `B:2` annulée `lastSeenAt 11:00Z` → `cancelled 1, circulated 0, observed 1, planned 1`.
  - `circulation sans last_seen_at : celle qui est datée l'emporte` : insérer une copie avec `last_seen_at` nul par `update circulations set last_seen_at = null where trip_id = 'C:1'` ; l'autre `C:2` à 600 s datée → `'terminus:5-14': 1, circulated 1`.
  - `même numéro deux jours de suite : deux trains` : `D` le `2026-10-31` et le `2026-11-01` (arrivées respectives) → `stats_period('2026-10-31','2026-11-01',NOW)` donne `circulated 2`.
  - `toutes les variantes retirées et jamais observées : un train prévu, retiré tard` : `E:1` et `E:2` retirés, sans circulation → `planned 1, removed_late 1, observed 0`.
  - `canonical_trips : variante présente, puis import le plus récent` : `F:1` retiré, `F:2` présent, `F:3` retiré → `select trip_id from canonical_trips where train_number = 'F'` vaut `F:2` ; puis `G:1` et `G:2` tous deux retirés, `update trips_planned set last_import_at = '2026-11-01T08:00:00Z' where trip_id = 'G:2'` → `G:2`.
  - `anon lit stats_period à travers les vues` : `asAnon(db, () => db.query("select count(*) from public.stats_period('2026-11-01','2026-11-01',$1)", [NOW]))` ne lève pas.
- [ ] **Step 2: Lancer et voir échouer** : `npx vitest run tests/canonical-trains.test.ts` ; attendu : FAIL (`relation "canonical_trips" does not exist` et comptes doublés sur le premier test).
- [ ] **Step 3: Écrire la migration** (en-tête de commentaire qui résume cause et règle, comme les migrations précédentes) :
  - les deux index ;
  - les deux vues par `select distinct on (service_date, train_number) * … order by service_date, train_number, <ordre des Global Constraints>` ; grants à `anon` ;
  - `create or replace view public.circulation_measures` : même liste de colonnes que dans `20261026000001_aberrant_and_range.sql`, `from public.canonical_circulations c join public.trips_planned t on (service_date, trip_id)` ;
  - `create or replace function public.stats_period(...)` : copier le corps de `20261027000001_cause_categories.sql` et ne changer que la base : `from public.canonical_trips t left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number left join public.circulation_measures m on m.service_date = c.service_date and m.trip_id = c.trip_id`, et dans le critère « terminé » `public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now)`.
- [ ] **Step 4: Lancer toute la suite racine** : `npx vitest run` ; attendu : tous les tests passent, y compris `tests/measures.test.ts`, `tests/range-measures.test.ts`, `tests/daily-stats.test.ts`, `tests/cause-category.test.ts` sans modification (régression : leurs jeux n'ont pas de doublons).
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028000001_canonical_trains.sql tests/sql/harness.ts tests/canonical-trains.test.ts
git commit -m "feat(sql): un train par numéro et par jour dans les mesures et les stats"
```

---

### Task 2: `live_trains` sans doublon et rattrapage de l'historique

**Files:**
- Modify: `supabase/migrations/20261028000001_canonical_trains.sql`
- Test: `tests/canonical-trains.test.ts`, `tests/live.test.ts` (inchangé, doit passer)

**Interfaces:**
- Consumes : `public.canonical_circulations` (tâche 1).
- Produces : `public.live_trains(p_now timestamptz)` de même forme ; fin de migration qui rejoue `snapshot_day`.

- [ ] **Step 1: Test qui échoue** `live_trains : un numéro à deux variantes ne sort qu'une fois, avec la copie vue en dernier` : deux trajets `L:1` (retiré) et `L:2` (présent) du `2026-11-02`, mêmes arrêts que `STOPS` de `tests/live.test.ts` (Paris 11:00Z → Lyon → Marseille 12:30Z), circulations non terminées à `NOW` : `L:1` (`terminusDelayS` 300, `stopDelays { '1': 300 }`, `lastSeenAt 11:20Z`), `L:2` (`terminusDelayS` 600, `stopDelays { '1': 600 }`, `lastSeenAt 11:58Z`). Attendu : `live_trains(NOW)` contient une seule entrée de `train_number` `L`, de `trip_id` `L:2` et `delay_s` 600 ; et `asAnon` sur `select public.live_trains($1)` ne lève pas.
- [ ] **Step 2: Lancer et voir échouer** : `npx vitest run tests/canonical-trains.test.ts` ; attendu : FAIL (2 entrées `L`).
- [ ] **Step 3: Implémenter** : `create or replace function public.live_trains(p_now timestamptz default now())` en copiant le corps de `20261022000003_live_trains_window.sql`, seule ligne changée : `from public.canonical_circulations c` au lieu de `from public.circulations c`. Puis, en fin de migration, la boucle de rattrapage `snapshot_day(d)` du `2026-10-20` à la veille (Paris), identique à celle de `20261027000001_cause_categories.sql`.
- [ ] **Step 4: Vérifier** : `npx vitest run` (racine) ; attendu : tout passe, `tests/live.test.ts` inchangé.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028000001_canonical_trains.sql tests/canonical-trains.test.ts
git commit -m "feat(sql): live_trains sans doublon ; rattrapage de l'historique"
```

---

### Task 3: Méthodologie et aperçu sur les vraies données

**Files:**
- Modify: `web/app/methodologie/page.tsx` (section « Définitions »)
- Modify: `README.md` (une ligne dans la description des mesures)

- [ ] **Step 1: Texte** : dans « Définitions », ajouter la phrase de la spec : « Un train est identifié par son numéro et son jour de service ; les variantes de l'horaire créées par les réimports ne comptent qu'une fois. » et une phrase sur « COUV » : part des trains prévus (un par numéro et par jour, jours terminés depuis le 20 octobre) qui ont été observés dans le flux temps réel. Même ligne dans le README.
- [ ] **Step 2: Vérifier** : `cd web && npx tsc --noEmit && npx vitest run` ; attendu : propre.
- [ ] **Step 3: Aperçu en lecture seule sur la base de production** (outil `execute_sql`, aucune écriture) : pour les jours du 20 au 26 octobre, comparer l'actuel (`daily_stats`) et le dédoublonné (même calcul que `stats_period` réécrit en requête `with` à partir de `distinct on (service_date, train_number)`) sur `planned`, `observed`, `circulated`, `on_time_official`, `comp_pct_sum`, COUV. Attendu : environ −114 circulées, −225 points d'indemnité, COUV proche de 100 %. Consigner le tableau dans le compte rendu.
- [ ] **Step 4: Commit**

```bash
git add web/app/methodologie/page.tsx README.md
git commit -m "docs: un train par numéro et par jour ; définition de COUV"
```

---

### Task 4: Mise en production (après accord explicite à chaque étape)

- [ ] **Step 1: Migration** : appliquer `20261028000001_canonical_trains.sql` avec `apply_migration`. Contrôles : `select count(*) - count(distinct (e->>'service_date', e->>'train_number')) from jsonb_array_elements(public.live_trains()) e` vaut 0 ; totaux de `daily_stats` égaux à ceux de l'aperçu.
- [ ] **Step 2: Code** : fusion dans `main` et push (méthodologie).
- [ ] **Step 3: Vérification** : `/api/stats?period=7d` et `/api/cumul` (circulées et indemnités en baisse comme prévu, COUV proche de 100 % une fois le cache d'une heure expiré) ; écran : plus de numéro en double sur la carte.
