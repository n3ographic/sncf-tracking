# Plan 3 : carte temps réel (design)

## Objectif et périmètre

Page d'accueil = carte MapLibre des TGV en circulation, lue depuis `/api/live`, pour le grand public et le data-journalisme (ordinateur et mobile, lecture seule, sans compte).

Contenu : un point par train coloré selon le retard, fenêtre au clic (numéro, trajet, retard, cause, indemnité théorique par voyageur), filtres par marque et par axe, compteur de trains en retard, indicateur de fraîcheur de la donnée.

Hors périmètre : tracés SNCF Réseau (plan 3b : seule la fonction `segment` change), tableau de bord, liste latérale, suivi d'un train.

## Hypothèses

- `/api/live` renvoie par train `stops` = dernier arrêt portant un retard (A) et le suivant (B) ; sans retard connu, les deux premiers arrêts. Clés nulles omises. Voir README.
- Positions **estimées**, jamais mesurées ; toujours présentées comme telles.
- Fond de carte : style OpenFreeMap par URL, sans clé ; attribution visible.

## Unités

- `web/lib/position.ts` (pure) : `estimatePosition(train, now) → { lon, lat, state } | null`. `state` : `at_stop` | `moving` | `arrived`. `null` si aucun arrêt exploitable. Prend `segment(a, b) → [lon, lat][]` (tracé entre deux arrêts), droit aujourd'hui ; un plan 3b le remplacera sans toucher le reste.
  - Départ corrigé D = `dep` de A + `delay_s` de A ; arrivée corrigée R = `arr` de B + `delay_s` de A (retard supposé constant).
  - `now` < D : à l'arrêt A. D ≤ `now` < R : progression linéaire sur le tracé. `now` ≥ R : arrêt B (`arrived`).
  - Un seul arrêt (dernier arrêt ou fenêtre réduite) : à l'arrêt. Intervalle D ≥ R : à l'arrêt B.
  - Train sans retard connu (`last_seq` absent) : les deux premiers arrêts, retard 0, même règle.
- `web/lib/map-model.ts` (pure) : `delayClass(train)` (`ontime` < 5 min, `late` ≥ 5 min, `severe` ≥ 30 min, `cancelled`) ; `applyFilters(trains, { brand, axis })` ; `lateCount(trains)` ; `freshness(train, now)` (`stale` si `last_seen_at` a plus de 10 min).
- `web/app/carte-view.tsx` (composant client) : monte MapLibre, interroge `/api/live` toutes les 60 s, met à jour une source GeoJSON chaque seconde, gère fenêtre au clic, filtres, bannière.
- `web/app/page.tsx` : rend la carte (chargement dynamique sans SSR).
- Dépendance neuve : `maplibre-gl` (version épinglée, CSS inclus). Pas de wrapper React.

## Flux

Chargement puis toutes les 60 s : `fetch('/api/live')` (le cache de bord de 3 min s'applique). Chaque seconde : `estimatePosition` pour chaque train puis `setData` d'une seule source (~170 points). Aucune logique de fuseau côté client : les instants sont des ISO.

## Erreurs

- `/api/live` en échec : on conserve les derniers trains, bannière « données non actualisées depuis X min ». Jamais d'écran vide.
- Train sans arrêt exploitable : non dessiné.
- Donnée périmée (`last_seen_at` > 10 min) : point estompé et mention dans la fenêtre.
- Annulé : point gris à l'arrêt A, mention « annulé ».

## Tests

Vitest sur `position.ts` et `map-model.ts` : avant le départ, à l'arrêt, en route (milieu de segment), retard nul / grand, arrivé, un seul arrêt, intervalle nul ou inversé, annulé, `last_seen_at` périmé, filtres. Page vérifiée à la main dans le navigateur intégré (bureau et mobile).
