# Plan 3b : tracés des voies (design)

## Objectif et périmètre

Les trains de la carte suivent les voies réelles entre deux arrêts au lieu d'une ligne droite. Seule la fonction `segment(a, b)` de `web/lib/position.ts` est remplacée à l'usage ; l'API `/api/live`, le calcul de progression et l'interface ne changent pas.

Hors périmètre : affichage des lignes comme fond de carte, positions mesurées, relance automatique du précalcul (script manuel pour l'instant).

## Source et licence

Jeu « Fichier de formes des lignes du Réseau Ferré National » (SNCF Réseau, data.sncf.com, ODbL) : 1 638 tronçons (`LineString`) avec `code_ligne`, `libelle`, `mnemo`. Export GeoJSON : `https://data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson`. Les tronçons `libelle` = « Neutralisée » sont exclus. Le jeu n'a ni gares ni graphe : le réseau se reconstitue à partir des tronçons.

Le fichier produit est une base dérivée : publié sous ODbL (README, section Sources et licence) avec attribution « Contient des informations de SNCF Réseau, sous licence ODbL ».

## Principe

Précalcul hors ligne (script versionné), résultat statique chargé par le navigateur.

## Unités

- `scripts/build-traces.ts` (commande `npm run build:traces`) : télécharge le jeu dans `tmp/` (git-ignoré), lit les paires d'arrêts consécutifs distinctes et les coordonnées des gares dans la base (tables publiques `stop_times_planned` et `stops`, clé publique `anon`, pagination), calcule un tracé par paire, écrit `web/public/trace-paires.json`, affiche un compte rendu (voir Qualité).
- `scripts/lib/rail-graph.ts` (pur, testé) : `buildGraph(troncons)`, `nearestNode(graph, lon, lat, maxM)`, `shortestPath(graph, from, to)`, `simplify(line, toleranceM)`, `haversineM`.
  - Nœuds : sommets des tronçons ; deux sommets à moins de 25 m sont fusionnés (grille de hachage), sans quoi les jonctions ne se rejoignent pas.
  - Arêtes pondérées par la distance haversine ; plus court chemin par Dijkstra.
  - Une gare est accrochée au nœud le plus proche à moins de 1 000 m ; sinon pas de tracé.
  - Un tracé est rejeté (ligne droite) si sa longueur dépasse 1,5 fois la distance à vol d'oiseau, ou si les deux gares sont accrochées au même nœud.
- `web/lib/traces.ts` (pur, testé) : `makeSegment(table: TraceTable): (a: Lngl, b: Lngl) => Lngl[]`. Clé = `lon,lat|lon,lat` avec coordonnées arrondies à 3 décimales (celles de `/api/live`), les deux extrémités triées ; une paire stockée dans un sens est renvoyée inversée dans l'autre ; paire absente : `[a, b]`.
- `web/lib/position.ts` : `along()` pondère la longitude par `cos(latitude)` pour que les distances le long d'une polyligne courbe soient proportionnelles aux vraies longueurs.
- `web/lib/map-model.ts` : `toFeatureCollection(trains, now, path?)` transmet `path` à `estimatePosition`.
- `web/app/carte-view.tsx` : charge `/trace-paires.json` une fois au montage ; en cas d'échec, lignes droites sans message.

## Format du fichier

`{ "version": 1, "source": "...", "generated_at": "...", "pairs": { "<clé>": [[lon, lat], ...] } }`. Coordonnées à 4 décimales (≈ 11 m), polylignes simplifiées (Douglas-Peucker, tolérance 30 m), une seule direction par paire. Budget : ≤ 500 Ko avant compression.

## Erreurs et limites

- Paire absente, gare hors réseau (étranger), accrochage ou chemin rejeté : ligne droite (comportement actuel).
- Variantes d'itinéraire (ligne classique en cas d'incident) : le plus court chemin est supposé ; non modélisé.
- Nouvelles paires après un changement de plan de transport : droites jusqu'à la relance de `npm run build:traces`.

## Qualité

Le script affiche : paires tracées / total, rejets par motif (accrochage, détour, même nœud), gares non accrochées, rapport médian et maximal longueur du tracé / distance à vol d'oiseau, taille du fichier. Seuil de livraison : au moins 85 % des paires tracées, taille ≤ 500 Ko ; les gares non accrochées sont listées dans `docs/findings/`.

## Tests

- `rail-graph` : réseau synthétique (fusion à moins de 25 m, plus court chemin entre deux branches, accrochage au plus proche, refus au-delà de 1 000 m, simplification qui garde les extrémités, détour rejeté).
- `traces` : clé identique dans les deux sens, tracé inversé, repli droit, arrondi à 3 décimales.
- `position` : une polyligne coudée à latitude élevée est parcourue au prorata de la vraie longueur (cas `cos(lat)`).
- Vérification visuelle : un train sur Paris–Lyon suit la LGV, pas la droite.
