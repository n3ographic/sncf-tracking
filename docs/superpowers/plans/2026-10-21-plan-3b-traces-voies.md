# Tracés des voies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les trains de la carte suivent les voies réelles entre deux arrêts, grâce à un fichier de tracés précalculé à partir des formes de lignes de SNCF Réseau.

**Architecture:** Un script hors ligne reconstitue le graphe ferroviaire, calcule le plus court chemin pour chaque paire d'arrêts consécutifs vue dans la base et écrit `web/public/trace-paires.json`. Le navigateur charge ce fichier une fois et `makeSegment` fournit la fonction `path` déjà acceptée par `estimatePosition`. Toute paire absente retombe sur la ligne droite actuelle.

**Tech Stack:** TypeScript, tsx (script), Vitest, Next.js 15 (fichier statique dans `web/public`).

**Spec:** `docs/superpowers/specs/2026-10-21-traces-voies-design.md`

## Global Constraints

- Source : `https://data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson` (ODbL) ; tronçons dont `libelle` vaut « Neutralisée » exclus.
- Fusion des sommets à moins de 25 m ; accrochage d'une gare au nœud le plus proche à moins de 1 000 m ; tracé rejeté si longueur > 1,5 × distance à vol d'oiseau, ou si les deux gares tombent sur le même nœud.
- Fichier : `{ "version": 1, "source": string, "generated_at": string, "pairs": { "<clé>": [[lon, lat], ...] } }` ; clé = `lon,lat|lon,lat` (coordonnées à 3 décimales, extrémités triées par ordre lexicographique de la chaîne) ; une seule direction par paire ; points à 4 décimales ; simplification Douglas-Peucker à 30 m ; ≤ 500 Ko avant compression.
- Seuil de livraison : au moins 85 % des paires tracées.
- Base dérivée ODbL : attribution « Contient des informations de SNCF Réseau, sous licence ODbL. » au README.
- Aucune dépendance neuve ; la clé utilisée par le script est la clé publique `anon`, jamais la clé service role.
- `maplibre-gl` et `/api/live` inchangés ; pas de `stop_id` ajouté à l'API.

## Review Focus

- Gare hors réseau (étranger, accrochage à plus de 1 000 m) : pas de tracé, repli en ligne droite sans erreur (Tasks 1 et 3).
- Deux gares accrochées au même nœud : pas de tracé de longueur nulle (Task 1).
- Chemin qui fait un grand détour (mauvais accrochage) : rejeté (Task 1).
- Paire stockée dans un sens, demandée dans l'autre : tracé inversé (Task 2).
- Deux gares distinctes aux mêmes coordonnées arrondies : la paire est ignorée par le script plutôt que d'écraser une autre clé (Task 3).
- Fichier de tracés absent ou illisible dans le navigateur : lignes droites, carte fonctionnelle (Task 4, vérification manuelle).

---

### Task 1: Graphe ferroviaire et plus court chemin

**Files:**
- Create: `scripts/lib/rail-graph.ts`
- Test: `tests/rail-graph.test.ts`

**Interfaces:**
- Produces:
  - `type Lngl = [number, number]`
  - `type Troncon = Lngl[]` (polyligne d'un tronçon)
  - `type Graph` (opaque ; nœuds, arêtes pondérées en mètres)
  - `haversineM(a: Lngl, b: Lngl): number`
  - `buildGraph(troncons: Troncon[], mergeM?: number): Graph` (`mergeM` = 25 par défaut)
  - `nearestNode(g: Graph, p: Lngl, maxM?: number): number | null` (`maxM` = 1000 par défaut ; `null` au-delà)
  - `shortestPath(g: Graph, from: number, to: number): Lngl[] | null` (`null` si non connectés)
  - `simplify(line: Lngl[], toleranceM: number): Lngl[]` (garde toujours le premier et le dernier point)
  - `traceBetween(g: Graph, a: Lngl, b: Lngl, maxDetour?: number): Lngl[] | { reason: 'unsnapped' | 'same_node' | 'unreachable' | 'detour' }` (`maxDetour` = 1,5)

- [ ] **Step 1: Write the failing tests** dans `tests/rail-graph.test.ts`, sur un réseau synthétique (coordonnées proches de 47° N) :
  - deux tronçons dont les extrémités sont à ~10 m l'un de l'autre sont connectés : `shortestPath` entre le premier et le dernier nœud traverse la jonction ; à ~60 m ils ne le sont pas (`null`).
  - bifurcation en Y : le plus court chemin choisit la branche courte entre deux gares ; la longueur renvoyée vaut la somme des arêtes (`haversineM`) à 1 % près.
  - `nearestNode` renvoie le nœud le plus proche à moins de 1 000 m et `null` à 1 500 m.
  - `simplify` : points alignés réduits à deux (extrémités conservées), un coude de plus de 30 m est conservé.
  - `traceBetween` : tracé direct valide ; `{ reason: 'same_node' }` pour deux gares accrochées au même nœud ; `{ reason: 'unsnapped' }` pour une gare à 5 km du réseau ; `{ reason: 'detour' }` quand le seul chemin fait plus de 1,5 fois la distance à vol d'oiseau ; `{ reason: 'unreachable' }` pour deux composantes séparées.
- [ ] **Step 2: Run** `npx vitest run tests/rail-graph.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** les six fonctions dans `scripts/lib/rail-graph.ts`. Fusion des sommets par grille de hachage (cellule ≈ `mergeM`, voisinage 3×3, nœud représentant = premier sommet rencontré). Dijkstra avec tas binaire ou file à priorité simple ; Douglas-Peucker en mètres via une projection locale équirectangulaire.
- [ ] **Step 4: Run** la même commande — Expected: PASS.
- [ ] **Step 5: Commit** — `feat: graphe ferroviaire et tracé entre deux gares`

### Task 2: Recherche de tracé côté web et progression pondérée

**Files:**
- Create: `web/lib/traces.ts`
- Modify: `web/lib/position.ts` (fonction `along`), `web/lib/map-model.ts` (`toFeatureCollection`)
- Test: `web/tests/traces.test.ts`, `web/tests/position.test.ts`, `web/tests/map-model.test.ts`

**Interfaces:**
- Consumes: `Lngl`, `segment`, `estimatePosition` de `web/lib/position.ts`.
- Produces:
  - `type TraceTable = { pairs: Record<string, [number, number][]> }`
  - `pairKey(a: Lngl, b: Lngl): string` — clé triée à 3 décimales (voir Global Constraints)
  - `makeSegment(table: TraceTable): (a: Lngl, b: Lngl) => Lngl[]`
  - `toFeatureCollection(trains, now, path?)` : `path` transmis à `estimatePosition` ; sans `path`, comportement actuel.

- [ ] **Step 1: Write the failing tests.** `traces.test.ts` : `pairKey(a, b) === pairKey(b, a)` ; l'arrondi à 3 décimales rend identiques `[2.3331, 48.8441]` et `[2.3334, 48.8444]` ; `makeSegment` renvoie le tracé stocké pour la paire, le renvoie inversé pour le sens contraire (premier point = `b` demandé en premier), renvoie `[a, b]` pour une paire absente et pour une table vide. `position.test.ts` : à 60° N, polyligne en L (un côté de 1° en longitude, un côté de 1° en latitude) — le point à mi-longueur est atteint là où les distances réelles le disent (le côté en longitude est ~2 fois plus court qu'un degré de latitude), à 1 % près. `map-model.test.ts` : `toFeatureCollection` avec un `path` à trois points place le train sur la polyligne.
- [ ] **Step 2: Run** `cd web && npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** `pairKey` et `makeSegment` dans `web/lib/traces.ts` ; dans `along`, multiplier les écarts de longitude par `cos(latitude moyenne du tronçon)` pour calculer les longueurs ; ajouter le paramètre optionnel `path` à `toFeatureCollection`.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npx vitest run` — Expected: tout passe, y compris les tests de position existants.
- [ ] **Step 5: Commit** — `feat: recherche de tracé par paire d'arrêts, progression pondérée par la latitude`

### Task 3: Script de précalcul et fichier de tracés

**Files:**
- Create: `scripts/build-traces.ts`, `web/public/trace-paires.json` (généré), `docs/findings/2026-10-21-traces.md`
- Modify: `package.json` (script `build:traces`)

**Interfaces:**
- Consumes: `buildGraph`, `nearestNode`, `traceBetween`, `simplify` (Task 1) ; `pairKey` de `web/lib/traces.ts` (Task 2) pour fabriquer les clés.
- Produces: `web/public/trace-paires.json` au format des Global Constraints ; compte rendu chiffré.

- [ ] **Step 1: Implement `scripts/build-traces.ts`.** Télécharge le GeoJSON dans `tmp/formes-rfn.geojson` (réutilise le fichier s'il existe), filtre les tronçons neutralisés, construit le graphe. Lit via l'API REST publique (clé `anon`, variables `SUPABASE_URL` et `SUPABASE_ANON_KEY`, pagination par pages de 1 000) les tables `stops` (`stop_id`, `lat`, `lon`) et `stop_times_planned` (`service_date`, `trip_id`, `stop_id`, `stop_sequence`) ; en déduit les paires consécutives distinctes (par `stop_id`). Pour chaque paire : tracé via `traceBetween`, simplification à 30 m, arrondi à 4 décimales, clé `pairKey` ; une clé déjà prise par une autre paire est ignorée et comptée (collision). Écrit le JSON et affiche : paires tracées / total, rejets par motif (`unsnapped`, `same_node`, `unreachable`, `detour`, collision), gares non accrochées, rapport longueur du tracé / distance à vol d'oiseau (médian, maximal), taille du fichier.
- [ ] **Step 2: Run** `npx tsx scripts/build-traces.ts` (avec les variables d'environnement lues dans `web/.env.local`) — Expected: au moins 85 % des paires tracées, fichier ≤ 500 Ko, rapport médian proche de 1. Sinon : diagnostiquer (tolérance de fusion, seuil d'accrochage) sur les paires rejetées et le consigner, sans abaisser les seuils sans le noter.
- [ ] **Step 3: Vérifier** que `tsc` et tous les tests passent (`npx vitest run` à la racine et dans `web/`).
- [ ] **Step 4: Rédiger** `docs/findings/2026-10-21-traces.md` : chiffres du script, liste des gares non accrochées, réglages retenus.
- [ ] **Step 5: Commit** — `feat: script de précalcul des tracés et fichier de tracés`

### Task 4: Branchement dans la carte, attribution et mise en ligne

**Files:**
- Modify: `web/app/carte-view.tsx`, `README.md`, `docs/findings/2026-10-21-traces.md`

**Interfaces:**
- Consumes: `makeSegment`, `TraceTable` (Task 2), `toFeatureCollection(trains, now, path?)`, `web/public/trace-paires.json` (Task 3).

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 3.**

- [ ] **Step 1: Implement** dans `carte-view.tsx` : au montage, `fetch('/trace-paires.json')` une fois ; si la réponse est valide, construire `makeSegment(table)` et le passer à `toFeatureCollection` (référence conservée dans un `useRef`) ; en cas d'échec ou de contenu invalide, rester sur `segment` sans message ni erreur.
- [ ] **Step 2: Vérifier** : `cd web && npx tsc --noEmit && npm run build && npx vitest run` passent ; `npx next dev` dans `web/`, navigateur intégré : un train sur un axe courbe (par exemple Paris – Lyon ou Paris – Bordeaux) suit la voie et non la droite ; en bloquant `/trace-paires.json` (hors ligne), la carte garde des points en ligne droite ; consigner ce qui a été vu dans `docs/findings/2026-10-21-traces.md`. README : section Carte (« tracés réels des voies ») et attribution ODbL SNCF Réseau ; commit — `feat: tracés de voies sur la carte`.
- [ ] **Step 3: Après accord**, fusion rapide de la branche dans `main`, `git push origin main`, puis `cd web && vercel deploy --prod --yes`.
- [ ] **Step 4: Vérifier en production** : `curl -s -o /dev/null -w '%{http_code} %{size_download}' https://sncf-tracking.vercel.app/trace-paires.json` renvoie 200 et une taille ≤ 500 Ko ; la page affiche la carte ; consigner dans les findings, commit et push (après accord) — `docs: vérification des tracés en production`.

---

**Plan suivant** : plan 4 (tableau de bord, compteur cumulé, page méthodologie).
