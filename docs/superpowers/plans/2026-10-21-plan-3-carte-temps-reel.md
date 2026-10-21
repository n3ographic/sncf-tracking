# Carte temps réel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la page d'accueil par une carte MapLibre des TGV en circulation, avec positions estimées, filtres marque et axe, compteur de retards et fenêtre au clic.

**Architecture:** Deux modules purs testés (`position.ts` : estimation d'un point à partir des deux arrêts renvoyés par `/api/live` ; `map-model.ts` : classes de retard, filtres, fraîcheur, GeoJSON) et un composant client (`carte-view.tsx`) qui interroge `/api/live` toutes les 60 s et met à jour une source GeoJSON chaque seconde. Le tracé entre deux arrêts passe par une fonction `segment`, droite aujourd'hui, pour que le plan 3b branche les tracés SNCF Réseau sans toucher le reste.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Vitest, `maplibre-gl` 4.7.1, fond OpenFreeMap.

**Spec:** `docs/superpowers/specs/2026-10-21-carte-temps-reel-design.md`

## Global Constraints

- Positions toujours présentées comme « estimées » ; jamais présentées comme mesurées.
- Fond de carte : style `https://tiles.openfreemap.org/styles/positron`, sans clé ; attribution OpenStreetMap / OpenFreeMap visible.
- Seuils de retard : `ontime` < 300 s, `late` ≥ 300 s, `severe` ≥ 1800 s ; `cancelled` prime sur le retard.
- Donnée périmée : `last_seen_at` à plus de 600 s de `now` (ou absent).
- Rafraîchissement : `/api/live` toutes les 60 s ; positions recalculées toutes les 1 s.
- Dépendance neuve unique : `maplibre-gl` 4.7.1 (version épinglée, sans `^`) ; aucun wrapper React.
- Code et textes visibles en français ; identifiants de code inchangés (voir `web/lib/live.ts`).
- Contrat de `/api/live` (README) : par train, `stops` = dernier arrêt portant un retard puis le suivant (les deux premiers sans retard connu), clés nulles omises, `origin` et `dest` en chaînes.

## Review Focus

- Train avec `stops` vide ou un seul arrêt : `estimatePosition` renvoie `null` (aucun arrêt) ou l'arrêt (un seul), sans exception (Task 1).
- Arrêt sans `lat`/`lon` ou horaire illisible : `null`, pas de `NaN` dans le GeoJSON (Task 1).
- Retard négatif (train en avance) : traité comme à l'heure, position cohérente (Tasks 1 et 2).
- Intervalle départ corrigé ≥ arrivée corrigée : pas de division par zéro, train à l'arrêt B (Task 1).
- Liste vide ou filtres sans résultat : compteurs à 0, carte vide, pas d'erreur (Task 2).
- `/api/live` en échec ou lent : on garde les derniers trains et on affiche une bannière, jamais d'écran vide (Task 3, vérification manuelle).

---

### Task 1: Estimation de position

**Files:**
- Create: `web/lib/position.ts`
- Test: `web/tests/position.test.ts`

**Interfaces:**
- Consumes: `LiveTrain`, `LiveStop` de `web/lib/live.ts` (`stops` ordonnés par `seq`, `delay_s?`, `cancelled`).
- Produces:
  - `type Lngl = [number, number]` (lon, lat)
  - `type PositionState = 'at_stop' | 'moving' | 'arrived'`
  - `type Estimate = { lon: number; lat: number; state: PositionState }`
  - `segment(a: Lngl, b: Lngl): Lngl[]` — tracé entre deux arrêts ; renvoie `[a, b]`.
  - `estimatePosition(train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>, now: Date, path?: typeof segment): Estimate | null`

- [ ] **Step 1: Write the failing tests** dans `web/tests/position.test.ts`. Fabrique `train(stops, delay_s?, cancelled?)` ; arrêts A `{seq:1, lon:2, lat:48, dep:'2026-11-02T11:00:00Z'}`, B `{seq:2, lon:4, lat:46, arr:'2026-11-02T12:00:00Z'}`. Cas et assertions :
  - `now` 10:50Z, retard 0 → `{lon:2, lat:48, state:'at_stop'}`.
  - `now` 11:30Z, retard 0 (milieu du trajet) → `state:'moving'`, `lon` ≈ 3, `lat` ≈ 47 (`toBeCloseTo`).
  - `now` 12:10Z, retard 0 → `{lon:4, lat:46, state:'arrived'}`.
  - retard 600 s, `now` 11:05Z → `at_stop` en A (départ corrigé 11:10Z) ; `now` 11:40Z → `moving` avec progression (11:40−11:10)/(12:10−11:10) = 0,5.
  - retard négatif (−120 s) traité comme 0 : `now` 11:30Z → milieu exact comme le cas retard 0.
  - un seul arrêt → `at_stop` à cet arrêt ; `stops: []` → `null`.
  - annulé (`cancelled: true`) → `at_stop` en A quel que soit `now`.
  - arrêt A sans `lat` ou `lon` → `null` ; horaire illisible (`dep: 'pas une date'`) → `null`.
  - départ corrigé ≥ arrivée corrigée (A.dep 12:00Z, B.arr 12:00Z) → `arrived` en B.
  - la fonction `path` injectée est utilisée : avec un `path` à trois points `[A, milieu décalé, B]`, la position en milieu de trajet suit la polyligne (longueur totale parcourue au prorata).
- [ ] **Step 2: Run** `cd web && npx vitest run tests/position.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `segment` et `estimatePosition` dans `web/lib/position.ts`. A = `stops[0]`, B = `stops[1]`. Départ corrigé D = `dep ?? arr` de A + max(`delay_s`, 0) ; arrivée corrigée R = `arr ?? dep` de B + même retard. Progression p = (now − D)/(R − D) bornée à [0,1] ; position = point à la fraction p de la longueur de la polyligne `path(A, B)` (interpolation linéaire par tronçon, distances euclidiennes en degrés suffisantes à cette échelle). Renvoyer `null` si une coordonnée ou un horaire est invalide (`Number.isFinite`).
- [ ] **Step 4: Run** la même commande — Expected: PASS.
- [ ] **Step 5: Commit** — `feat: estimation de position des trains entre deux arrêts`

### Task 2: Modèle de carte

**Files:**
- Create: `web/lib/map-model.ts`
- Test: `web/tests/map-model.test.ts`

**Interfaces:**
- Consumes: `LiveTrain` (`web/lib/live.ts`), `estimatePosition` et `Estimate` (Task 1).
- Produces:
  - `type LiveItem = LiveTrain & { comp_eur_per_passenger_ref: number }`
  - `type DelayClass = 'ontime' | 'late' | 'severe' | 'cancelled'`
  - `delayClass(t: Pick<LiveItem, 'cancelled' | 'delay_s'>): DelayClass`
  - `type Filters = { brand: 'ALL' | 'INOUI' | 'OUIGO'; axis: string }` (`axis: 'ALL'` pour tous)
  - `applyFilters(trains: LiveItem[], f: Filters): LiveItem[]`
  - `axes(trains: LiveItem[]): string[]` — axes distincts, triés
  - `lateCount(trains: LiveItem[]): number` — trains `late` ou `severe`
  - `isStale(t: Pick<LiveItem, 'last_seen_at'>, now: Date): boolean`
  - `toFeatureCollection(trains: LiveItem[], now: Date): GeoJSON.FeatureCollection<GeoJSON.Point>` — un feature par train dont `estimatePosition` n'est pas `null` ; propriétés `trip_id`, `cls` (`DelayClass`), `stale` (booléen), `state`

- [ ] **Step 1: Write the failing tests** dans `web/tests/map-model.test.ts` (fabrique `item(over)` avec `brand`, `axis`, `delay_s`, `cancelled`, `last_seen_at`, `stops`) :
  - `delayClass` : 299 s → `ontime`, 300 → `late`, 1799 → `late`, 1800 → `severe`, absent → `ontime`, −60 → `ontime`, `cancelled: true` avec `delay_s: 4000` → `cancelled`.
  - `applyFilters` : par marque, par axe, les deux, `ALL`/`ALL` rend tout ; aucun résultat → `[]`.
  - `axes` : `['SUD_EST','EST','SUD_EST']` → `['EST','SUD_EST']` ; liste vide → `[]`.
  - `lateCount` : `ontime`, `late`, `severe`, `cancelled` → 2 ; liste vide → 0.
  - `isStale` : vu il y a 599 s → faux, 601 s → vrai, `last_seen_at` absent → vrai.
  - `toFeatureCollection` : coordonnées `[lon, lat]`, `cls` et `stale` attendus ; un train à `stops: []` est omis ; aucun `NaN` dans les coordonnées ; liste vide → `features: []`.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/map-model.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les six fonctions dans `web/lib/map-model.ts` (seuils des Global Constraints en constantes nommées).
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npx vitest run` — Expected: tout passe.
- [ ] **Step 5: Commit** — `feat: modèle de carte (classes de retard, filtres, fraîcheur, GeoJSON)`

### Task 3: Page carte

**Files:**
- Create: `web/app/carte-view.tsx`, `web/app/carte.css`
- Modify: `web/app/page.tsx` (rend `<CarteView />` ; garde la mention « indépendant, non affilié à SNCF ni à OUIGO » dans la page), `web/app/layout.tsx` (importe `maplibre-gl/dist/maplibre-gl.css` et `./carte.css`), `web/package.json` (+ `maplibre-gl` 4.7.1)

**Interfaces:**
- Consumes: `toFeatureCollection`, `applyFilters`, `axes`, `lateCount`, `isStale`, `delayClass`, `LiveItem`, `Filters` (Task 2) ; réponse `GET /api/live` = `{ generated_at: string; trains: LiveItem[] }`.
- Produces: composant client `CarteView(): JSX.Element` (`'use client'`), sans props.

- [ ] **Step 1: Installer** `cd web && npm install --save-exact maplibre-gl@4.7.1` ; vérifier `npm audit --omit=dev` (aucune alerte haute ou critique nouvelle).
- [ ] **Step 2: Implement `CarteView`**. `maplibre-gl` est importé dynamiquement dans un `useEffect` (pas de rendu serveur de la carte). Carte centrée sur la France (`center: [2.5, 46.6]`, `zoom: 5`), style OpenFreeMap, une source GeoJSON `trains` et une couche `circle` colorée par `cls` (vert / orange / rouge / gris), contour et opacité réduits si `stale`. Boucle `setInterval` 1 s : `toFeatureCollection(applyFilters(trains, filters), new Date())` puis `setData`. `fetch('/api/live')` au montage puis toutes les 60 s ; en cas d'échec, conserver les derniers trains et afficher la bannière « données non actualisées depuis X min ». Barre de contrôle : sélecteurs marque et axe, compteur « N trains en retard sur M ». Clic sur un point : fenêtre (`maplibregl.Popup`) avec numéro, `origin → dest`, retard en minutes, cause si présente, indemnité théorique par voyageur (`comp_eur_per_passenger_ref`), mention « position estimée » et « donnée périmée » si `isStale`. Lisible à 375 px de large (barre repliée en colonne), contrôles accessibles au clavier, textes en français. Nettoyage au démontage (`clearInterval`, `map.remove()`).
- [ ] **Step 3: Verify build** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe.
- [ ] **Step 4: Vérifier à la main** (`npx next dev` dans `web/`, navigateur intégré) : les points apparaissent et bougent ; un clic ouvre la fenêtre ; les filtres changent le compteur ; couper le réseau (hors ligne dans les outils du navigateur) fait apparaître la bannière sans vider la carte ; rendu correct à 375 px. Consigner dans `docs/findings/2026-10-21-carte.md` ce qui a été vu (nombre de points, anomalies).
- [ ] **Step 5: Commit** — `feat: carte temps réel des trains`

### Task 4: Documentation et mise en ligne

**Files:**
- Modify: `README.md` (section « Carte » : page d'accueil, positions estimées et leur règle, fond OpenFreeMap, limites), `docs/findings/2026-10-21-carte.md`

**Interfaces:**
- Consumes: Tasks 1 à 3.
- Produces: carte en production sur `https://sncf-tracking.vercel.app`.

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 2.**

- [ ] **Step 1: Documenter** dans le README la règle d'estimation (retard constant, ligne droite entre deux arrêts, tracés réels prévus au plan 3b) et l'attribution du fond de carte ; commit — `docs: carte temps réel`.
- [ ] **Step 2: Après accord**, `git push origin main` puis `cd web && vercel deploy --prod --yes`.
- [ ] **Step 3: Vérifier en production** : `curl -s https://sncf-tracking.vercel.app/ | grep -c maplibre` > 0 ; ouvrir la page dans le navigateur intégré, constater des points et une fenêtre au clic ; consigner dans `docs/findings/2026-10-21-carte.md`, commit et push (après accord) — `docs: vérification de la carte en production`.

---

**Plan suivant** : 3b (tracés SNCF Réseau, remplacement de `segment`), puis le plan 4 (tableau de bord, compteur cumulé, méthodologie).
