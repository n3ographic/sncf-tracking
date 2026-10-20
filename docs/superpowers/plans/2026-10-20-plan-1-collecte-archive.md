# Plan 1 — Collecte et archive : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** collecter toutes les 2 min les retards, suppressions et alertes des TGV INOUI et OUIGO, et les archiver dans Supabase, avec un export mensuel public et une purge sûre.

**Architecture :** la logique métier est en TypeScript pur, sans API Deno ni Node, dans `supabase/functions/_shared/`. Elle est testée sous Node avec vitest et importée telle quelle par l'Edge Function (Deno) et par les scripts Node lancés dans GitHub Actions.
- Collecte : pg_cron appelle l'Edge Function `collect` via `pg_net`.
- Import du GTFS statique et export mensuel : GitHub Actions.
- Purge : pg_cron, en SQL pur.

**Tech Stack :** Node 24, TypeScript, vitest@2.1.1, tsx@4.19.1, gtfs-realtime-bindings@1.1.1, @supabase/supabase-js@2.45.4, fflate@0.8.2, csv-parse@5.5.6, Supabase (Postgres 17, pg_cron, pg_net, Edge Functions Deno), GitHub Actions.

**Spec :** `docs/superpowers/specs/2026-10-20-observatoire-tgv-design.md`

## Global Constraints

- Coût nul : Supabase Free (500 Mo de base, 500 000 invocations d'Edge Functions par mois), GitHub Actions sur un dépôt public. Aucun service payant.
- Pas de stockage du brut GTFS-RT. On n'écrit que des changements.
- Seuls les trajets INOUI et OUIGO présents dans `trips_planned` sont collectés.
- `brand` ∈ {`INOUI`, `OUIGO`} et `axis` ∈ {`NORD`, `SUD_EST`, `ATLANTIQUE`, `EST`, `INTERSECTEURS`}. Ces chaînes sont exactes, en majuscules.
- `events` est append-only : aucun `UPDATE`. Le seul `DELETE` autorisé est celui de la purge, après export confirmé.
- Purge : seulement les événements de plus de 30 jours **et** dont le mois figure dans `exports`.
- Toutes les dates de service sont au format `date` Postgres, dérivées de `trip.start_date` (`YYYYMMDD`) du flux. Les heures sont en `timestamptz`, fuseau `Europe/Paris`.
- La clé `SUPABASE_SERVICE_ROLE_KEY` n'apparaît que dans les secrets (Supabase et GitHub). Jamais dans le code ni dans un commit.
- Commentaires et messages de commit en français. Identifiants en anglais.

## Review Focus

1. **Flux indisponible ou tronqué** (HTTP différent de 200, timeout, protobuf invalide) : l'exécution échoue proprement, n'écrit rien et le journalise. Test dans la Task 5.
2. **Flux figé** (même `header.timestamp` que lors de la dernière exécution) : aucune écriture, pour ne pas fausser `last_seen_at`. Test dans la Task 5.
3. **Train à cheval sur minuit** : la date de service vient de `trip.start_date`, jamais de l'heure de collecte. Test dans la Task 3.
4. **Deux exécutions concurrentes ou rejouées** : relancer la collecte sur le même flux ne crée aucun événement en double. Test dans la Task 3, via un diff idempotent.
5. **Échec de l'export** : la purge ne supprime jamais un mois absent de `exports`. Test dans la Task 6.

---

### Task 1 : Initialisation et sondage du flux réel

Cette tâche épingle les valeurs dont dépendent les suivantes. **À faire en premier.**

**Files :**
- Create : `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts`
- Create : `scripts/inspect-feed.ts`
- Create : `docs/findings/2026-10-20-sondage-flux.md`

**Interfaces :**
- Produces : `docs/findings/2026-10-20-sondage-flux.md`, qui fixe :
  - `BRAND_RULES` : comment distinguer INOUI et OUIGO dans le GTFS statique (agence, route, préfixe de trip_id) ;
  - le format de `trip_id` et sa jointure GTFS-RT ↔ statique (`NewTripId`) ;
  - la présence de OUIGO dans Trip Updates (oui ou non, ce qui décide du plan B Navitia) ;
  - si `stop_time_update` porte `delay` ou seulement `time` ;
  - le nombre d'entités TGV par flux et l'estimation du volume de `events` par jour ;
  - le lien entre alertes et trajets (`informed_entity.trip.trip_id` ou `route_id`).

- [ ] **Step 1 : initialiser le dépôt** — `git init`, avec `package.json` (`"type": "module"`, scripts `test: vitest run` et `inspect: tsx scripts/inspect-feed.ts`) et les dépendances aux versions du Tech Stack. `.gitignore` contient `node_modules`, `.env*` et `tmp/`.
- [ ] **Step 2 : écrire `scripts/inspect-feed.ts`** — le script télécharge les deux flux, les décode avec `GtfsRealtimeBindings.transit_realtime.FeedMessage.decode`, puis télécharge le zip statique dans `tmp/` et lit `agency.txt`, `routes.txt` et `trips.txt` avec fflate et csv-parse. Il affiche : le nombre d'entités, 5 exemples de trip_id du flux et du statique, le taux de jointure, les agences et routes distinctes, la présence de `delay` ou de `time`, et la forme de `informed_entity`.
- [ ] **Step 3 : lancer** `npm run inspect`, deux fois à 10 min d'intervalle. Attendu : les deux flux sont décodés sans erreur et un taux de jointure est affiché.
- [ ] **Step 4 : rédiger le compte rendu** avec les valeurs ci-dessus. Si OUIGO est absent du flux ou si la jointure est inférieure à 95 %, **s'arrêter et remonter l'information à l'auteur** avant la Task 2.
- [ ] **Step 5 : commit** — `chore: initialisation et sondage des flux GTFS-RT SNCF`

### Task 2 : Projet Supabase et schéma

**Files :**
- Create : `supabase/config.toml` (via `supabase init`)
- Create : `supabase/migrations/20261020000001_schema.sql`

**Interfaces :**
- Produces :
  - `stops(stop_id text pk, name text not null, lat double precision, lon double precision)`
  - `trips_planned(service_date date, trip_id text, brand text not null, train_number text not null, axis text not null, origin_stop_id text, dest_stop_id text, dep_planned timestamptz, arr_planned timestamptz, primary key (service_date, trip_id))`
  - `stop_times_planned(service_date date, trip_id text, stop_sequence int, stop_id text, arr_planned timestamptz, dep_planned timestamptz, primary key (service_date, trip_id, stop_sequence))`
  - `circulations(service_date date, trip_id text, brand text, axis text, train_number text, arr_planned timestamptz, cancelled boolean not null default false, stop_delays jsonb not null default '{}', terminus_delay_s int, max_delay_s int, alert_ids text[] not null default '{}', cause text, first_seen_at timestamptz, last_seen_at timestamptz, primary key (service_date, trip_id))`. `stop_delays` associe `stop_sequence` (en chaîne) à un retard en secondes, ou à `"cancelled"`.
  - `events(id bigint generated always as identity pk, observed_at timestamptz not null, service_date date not null, trip_id text not null, kind text not null check (kind in ('first_seen','delay','stop_cancelled','cancelled','uncancelled','alert_added','alert_removed')), stop_sequence int, value jsonb not null)`, avec un index sur `(observed_at)`.
  - `exports(month date pk, release_url text not null, row_count int not null, exported_at timestamptz not null default now())`
  - `collector_state(id int pk check (id = 1), last_feed_ts bigint, last_run_at timestamptz, last_error text)`
- Contraintes `check` sur `brand` et `axis`, avec les valeurs des Global Constraints.
- RLS activée partout. Politique `select` pour `anon` sur `stops`, `trips_planned`, `circulations` et `exports`. Aucun accès `anon` à `events` ni à `collector_state` : les exports publics jouent ce rôle.

- [ ] **Step 1 : créer le projet** `sncf-tracking` en `eu-west-3` via le MCP Supabase (`get_cost`, puis `confirm_cost` et `create_project`), dans l'organisation existante.
- [ ] **Step 2 : écrire la migration** avec les tables ci-dessus, et `create extension if not exists pg_cron; create extension if not exists pg_net;`.
- [ ] **Step 3 : appliquer** la migration via `apply_migration`, puis vérifier avec `list_tables`. Attendu : les 7 tables sont présentes avec RLS activée.
- [ ] **Step 4 : vérifier la RLS** — `select` sur `events` avec la clé anon : 0 ligne ou erreur. `insert` sur `circulations` avec la clé anon : refusé.
- [ ] **Step 5 : commit** — `feat: schéma Supabase de la collecte`

### Task 3 : Logique pure (marque, axe, date de service, diff)

**Files :**
- Create : `supabase/functions/_shared/types.ts`, `supabase/functions/_shared/classify.ts`, `supabase/functions/_shared/diff.ts`
- Test : `tests/classify.test.ts`, `tests/diff.test.ts`

**Interfaces :**
- Produces (`types.ts`) :
  - `type Brand = 'INOUI' | 'OUIGO'`
  - `type Axis = 'NORD' | 'SUD_EST' | 'ATLANTIQUE' | 'EST' | 'INTERSECTEURS'`
  - `interface TripSnapshot { serviceDate: string; tripId: string; cancelled: boolean; stopDelays: Record<string, number | 'cancelled'>; alertIds: string[] }`
  - `type EventKind = 'first_seen' | 'delay' | 'stop_cancelled' | 'cancelled' | 'uncancelled' | 'alert_added' | 'alert_removed'`
  - `interface EventRow { observed_at: string; service_date: string; trip_id: string; kind: EventKind; stop_sequence: number | null; value: Record<string, unknown> }`
  - `interface PlannedStopTimes { serviceDate: string; tripId: string; arrPlanned: Record<string, string> }` : associe `stop_sequence` à une heure ISO.
  - `type DecodedFeed = ReturnType<typeof transit_realtime.FeedMessage.toObject>`, le flux décodé en objet simple.
  - `StopRow`, `TripPlannedRow`, `StopTimePlannedRow` : une interface par table de la Task 2, en snake_case et avec les mêmes colonnes.
- Produces (`classify.ts`) :
  - `brandOf(agencyName: string, routeShortName: string, tripId: string): Brand | null` : les règles viennent de `BRAND_RULES` (Task 1).
  - `axisOf(stopNames: string[]): Axis` : première gare parisienne rencontrée. `"Paris Nord"` → NORD, `"Paris Gare de Lyon"` ou `"Paris Bercy"` → SUD_EST, `"Paris Montparnasse"` → ATLANTIQUE, `"Paris Est"` → EST. Comparaison sur le nom normalisé (sans accents, minuscules, préfixe). Aucune gare parisienne → INTERSECTEURS.
  - `serviceDateOf(startDate: string): string` : `"20261020"` → `"2026-10-20"`. Lève une erreur si le format est invalide.
- Produces (`diff.ts`) :
  - `diffTrip(prev: TripSnapshot | null, next: TripSnapshot, observedAt: string): EventRow[]`

- [ ] **Step 1 : écrire les tests qui échouent**
```ts
test('axisOf', () => {
  expect(axisOf(['Lille Europe', 'Paris Nord'])).toBe('NORD')
  expect(axisOf(['Paris Gare de Lyon', 'Marseille St-Charles'])).toBe('SUD_EST')
  expect(axisOf(['Paris Bercy', 'Dijon'])).toBe('SUD_EST')
  expect(axisOf(['Paris Montparnasse', 'Bordeaux St-Jean'])).toBe('ATLANTIQUE')
  expect(axisOf(['Paris Est', 'Strasbourg'])).toBe('EST')
  expect(axisOf(['Lille Europe', 'Marne-la-Vallée Chessy', 'Lyon Part-Dieu'])).toBe('INTERSECTEURS')
})
test('serviceDateOf : vient du flux, pas de l’horloge (train à cheval sur minuit)', () => {
  expect(serviceDateOf('20261019')).toBe('2026-10-19')
  expect(() => serviceDateOf('2026-10-19')).toThrow()
})
const base = { serviceDate: '2026-10-20', tripId: 'T1', cancelled: false, stopDelays: { '1': 0, '2': 300 }, alertIds: [] }
test('première observation → first_seen + un delay par arrêt non nul', () => {
  const ev = diffTrip(null, base, 'now')
  expect(ev.map(e => e.kind)).toEqual(['first_seen', 'delay'])
  expect(ev[1]).toMatchObject({ stop_sequence: 2, value: { delay_s: 300 } })
})
test('idempotent : même snapshot → aucun événement', () => {
  expect(diffTrip(base, structuredClone(base), 'now')).toEqual([])
})
test('changement de retard → un seul delay avec ancien et nouveau', () => {
  const ev = diffTrip(base, { ...base, stopDelays: { '1': 0, '2': 600 } }, 'now')
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ kind: 'delay', stop_sequence: 2, value: { from_s: 300, delay_s: 600 } })
})
test('suppression, puis rétablissement', () => {
  const c = { ...base, cancelled: true }
  expect(diffTrip(base, c, 'now').map(e => e.kind)).toEqual(['cancelled'])
  expect(diffTrip(c, base, 'now').map(e => e.kind)).toEqual(['uncancelled'])
})
test('arrêt supprimé et alertes', () => {
  const n = { ...base, stopDelays: { '1': 0, '2': 'cancelled' as const }, alertIds: ['A1'] }
  expect(diffTrip(base, n, 'now').map(e => e.kind).sort()).toEqual(['alert_added', 'stop_cancelled'])
  expect(diffTrip(n, { ...n, alertIds: [] }, 'now').map(e => e.kind)).toEqual(['alert_removed'])
})
```
Ajouter dans `tests/classify.test.ts` un test `brandOf` avec 2 exemples réels INOUI et OUIGO tirés du compte rendu de la Task 1, plus un trajet TER qui renvoie `null`.
- [ ] **Step 2 : lancer** `npm test`. Attendu : FAIL, les modules n'existent pas encore.
- [ ] **Step 3 : implémenter** `types.ts`, `classify.ts` et `diff.ts`. Aucun import Deno ni Node : uniquement des imports relatifs avec l'extension `.ts`, pour que Deno les accepte.
- [ ] **Step 4 : lancer** `npm test`. Attendu : PASS.
- [ ] **Step 5 : commit** — `feat: classification marque/axe et diff idempotent des trajets`

### Task 4 : Import quotidien du GTFS statique

**Files :**
- Create : `supabase/functions/_shared/gtfs-static.ts`
- Create : `scripts/import-static.ts`
- Create : `.github/workflows/import-static.yml`
- Test : `tests/gtfs-static.test.ts`, avec une fixture `tests/fixtures/gtfs-mini/` contenant 1 trajet INOUI, 1 OUIGO et 1 TER

**Interfaces :**
- Consumes : `brandOf`, `axisOf` (Task 3)
- Produces : `buildPlanned(files: { agency: string; routes: string; trips: string; stop_times: string; stops: string; calendar_dates: string }, dates: string[]): { stops: StopRow[]; trips: TripPlannedRow[]; stopTimes: StopTimePlannedRow[] }`. Les colonnes sont celles des tables de la Task 2. Les heures GTFS au-delà de `24:00:00` basculent sur le lendemain, en Europe/Paris.

- [ ] **Step 1 : tests qui échouent** — avec `dates = ['2026-10-20']`, `buildPlanned` renvoie 2 trajets (pas de TER) avec la bonne `brand` et le bon `axis`. Un `departure_time` à `25:10:00` donne `2026-10-21T01:10:00+02:00`. Une date hors `calendar_dates` donne 0 trajet.
- [ ] **Step 2 : lancer** `npm test`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `buildPlanned`, puis `scripts/import-static.ts`. Le script télécharge le zip, décompresse avec fflate et appelle `buildPlanned` pour aujourd'hui, J+1 et J+2. Il fait ensuite des upserts par lots de 1 000 via supabase-js (clé service role lue dans `process.env`) et supprime les `stop_times_planned` antérieurs à J-1.
- [ ] **Step 4 : lancer** `npm test` (attendu : PASS), puis `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/import-static.ts`. Attendu : des trajets apparaissent dans `trips_planned` pour les 3 dates, avec les deux marques présentes.
- [ ] **Step 5 : écrire le workflow** — cron `15 2 * * *` et `workflow_dispatch`. Les secrets `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont ajoutés par l'auteur dans le dépôt GitHub. Le lancer à la main via `workflow_dispatch`. Attendu : vert.
- [ ] **Step 6 : commit** — `feat: import quotidien du GTFS statique INOUI/OUIGO`

### Task 5 : Edge Function `collect` et planification

**Files :**
- Create : `supabase/functions/_shared/snapshot.ts`
- Create : `supabase/functions/collect/index.ts`
- Create : `supabase/migrations/20261020000002_cron.sql`
- Test : `tests/snapshot.test.ts`, avec une fixture `tests/fixtures/trip-updates.json` (3 entités décodées, enregistrées pendant la Task 1)

**Interfaces :**
- Consumes : `diffTrip`, `serviceDateOf`, `TripSnapshot` (Task 3) et les tables de la Task 2
- Produces :
  - `snapshotsFromFeed(feed: DecodedFeed, alerts: DecodedFeed, planned: Map<string, PlannedStopTimes>): TripSnapshot[]`. La clé est `${serviceDate}|${tripId}`. Le retard vient de `delay` s'il est présent, sinon de `time − arr_planned` (selon la Task 1). Les trajets absents de `planned` sont ignorés.
  - Edge Function `POST /functions/v1/collect`, protégée par l'en-tête `x-collector-secret`. Elle renvoie `{ trips, events, skipped?: 'stale' }`.

- [ ] **Step 1 : tests qui échouent** — `snapshotsFromFeed` sur la fixture :
  - un trajet hors `planned` est ignoré ;
  - `schedule_relationship CANCELED` donne `cancelled: true` ;
  - un `time` sans `delay` donne un retard calculé en secondes ;
  - une alerte dont `informed_entity` vise le trajet place son id dans `alertIds`.
- [ ] **Step 2 : lancer** `npm test`. Attendu : FAIL.
- [ ] **Step 3 : implémenter `snapshot.ts`**, puis `collect/index.ts` (Deno, `npm:gtfs-realtime-bindings@1.1.1`, `npm:@supabase/supabase-js@2.45.4`). La fonction enchaîne :
  1. récupérer les 2 flux avec un timeout de 20 s ;
  2. sur HTTP non 200 ou échec du décodage, écrire `collector_state.last_error`, répondre 502 et **ne rien écrire d'autre** ;
  3. si `header.timestamp` est identique à `collector_state.last_feed_ts`, répondre `{ skipped: 'stale' }` sans rien écrire ;
  4. charger `stop_times_planned` pour J-1 et J ;
  5. charger les `circulations` correspondantes et reconstruire `prev` ;
  6. appliquer `diffTrip` ;
  7. insérer `events`, puis faire l'upsert de `circulations` : `stop_delays`, `cancelled`, `alert_ids`, `terminus_delay_s` (dernier arrêt), `max_delay_s`, `cause` (texte de la dernière alerte, en français si disponible) et `last_seen_at`. Mettre à jour `collector_state`.
- [ ] **Step 4 : lancer** `npm test`. Attendu : PASS.
- [ ] **Step 5 : déployer** avec `deploy_edge_function` (`verify_jwt: false`, protection par secret) et définir le secret `COLLECTOR_SECRET`. Appeler la fonction deux fois à la main, à moins de 2 min d'écart. Attendu : le premier appel renvoie `events > 0`, le second `skipped: 'stale'` ou `events` faible. Appeler sans secret : attendu 401.
- [ ] **Step 6 : écrire la migration cron** — `cron.schedule('collect', '*/2 * * * *', …)` avec `net.http_post` vers l'URL de la fonction et l'en-tête secret. Le secret est lu depuis Vault (`vault.decrypted_secrets`) et n'est jamais écrit en clair dans la migration. L'appliquer.
- [ ] **Step 7 : vérifier** au bout de 10 min. Attendu : `collector_state.last_run_at` date de moins de 3 min, `last_error` est nul, `circulations` contient des lignes INOUI (et OUIGO si la Task 1 l'a confirmé), et `select count(*) from events` augmente. Noter le volume par heure dans le compte rendu de la Task 1.
- [ ] **Step 8 : commit** — `feat: collecteur GTFS-RT toutes les 2 min`

### Task 6 : Export mensuel et purge sûre

**Files :**
- Create : `supabase/functions/_shared/csv.ts`
- Create : `scripts/export-month.ts`
- Create : `.github/workflows/export-month.yml`
- Create : `supabase/migrations/20261020000003_purge.sql`
- Test : `tests/csv.test.ts`, `tests/purge.sql.md` (requêtes de vérification commentées)

**Interfaces :**
- Consumes : tables `events` et `exports` (Task 2)
- Produces :
  - `toCsv(rows: Record<string, unknown>[], columns: string[]): string` : RFC 4180 (guillemets doublés, champs contenant `,`, `"` ou un saut de ligne entre guillemets), `value` en JSON, fins de ligne `\n`.
  - Release GitHub `events-YYYY-MM` contenant `events-YYYY-MM.csv.gz` et un fichier `LICENSE-ODbL.txt` avec la mention de crédit.
  - Fonction SQL `purge_events()` planifiée chaque jour.

- [ ] **Step 1 : tests qui échouent** — `toCsv` échappe `a,"b"` en `"a,""b"""`, sérialise `value` en JSON, et l'en-tête respecte l'ordre de `columns`.
- [ ] **Step 2 : lancer** `npm test`. Attendu : FAIL.
- [ ] **Step 3 : implémenter `toCsv`**, puis `scripts/export-month.ts <YYYY-MM>`. Le script lit `events` du mois par pages de 10 000, gzippe avec fflate, et écrit le fichier dans `tmp/`. Le workflow (cron `0 4 1 * *` et `workflow_dispatch`, mois précédent par défaut) crée la release avec `gh release create` (`GITHUB_TOKEN`, permission `contents: write`). **C'est seulement ensuite** qu'il insère la ligne dans `exports`, avec l'URL et le nombre de lignes, qui doit être égal au nombre de lignes du CSV.
- [ ] **Step 4 : écrire `purge_events()`** :
```sql
delete from events
where observed_at < now() - interval '30 days'
  and date_trunc('month', observed_at at time zone 'Europe/Paris')::date in (select month from exports);
```
La planifier via `cron.schedule('purge', '30 3 * * *', 'select purge_events()')`.
- [ ] **Step 5 : vérifier la purge** (Review Focus 5) : insérer 1 événement factice daté de 60 jours dans un mois absent de `exports`, puis lancer `select purge_events()`. Attendu : il est toujours là. Insérer la ligne `exports` de ce mois et relancer. Attendu : il a disparu. Nettoyer ensuite les données factices.
- [ ] **Step 6 : lancer** `npm test` (attendu : PASS), puis déclencher le workflow à la main sur le mois en cours, en test. Attendu : la release est créée et le CSV se décompresse avec le bon nombre de lignes. Supprimer cette release de test et sa ligne `exports`.
- [ ] **Step 7 : commit** — `feat: export mensuel ODbL et purge après export`

### Task 7 : Dépôt public et README

**Files :**
- Create : `README.md` (objet, indépendance « non affilié à SNCF ni OUIGO », sources et licence ODbL, architecture en 5 lignes, liste des secrets à définir)

- [ ] **Step 1 : rédiger le README.**
- [ ] **Step 2 : publier** — l'auteur crée le dépôt public, ou bien `gh repo create --public --source . --push` si `gh` est installé et authentifié. **Demander confirmation avant de pousser** : le dépôt est public.
- [ ] **Step 3 : vérifier** que les workflows des Tasks 4 et 6 apparaissent dans l'onglet Actions, et que les secrets sont définis.
- [ ] **Step 4 : commit** — `docs: README du projet`

---

**Plans suivants**, à rédiger quand ce plan tournera :
- Plan 2 : mesures (régularité officielle, mesure brute, barème provisoire) et route Vercel en cache 60 s.
- Plan 3 : carte MapLibre et tracés SNCF Réseau.
- Plan 4 : tableau de bord, compteur et méthodologie, avec vérification des barèmes dans le navigateur.
