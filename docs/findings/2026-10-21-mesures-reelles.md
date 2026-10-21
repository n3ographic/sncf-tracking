# Mesures sur les données réelles (2026-10-21)

Vérification du plan 2 (Task 5) sur la base de production, le 2026-10-21 entre 09:43 et 09:50 UTC.
Collecteur actif depuis le 2026-10-20 vers 20:07 UTC : la journée du 20 n'est couverte que le soir,
celle du 21 est en cours (seuls les trains terminés comptent).

## Migrations

- `measure_rules`, `measures`, `live_trains` appliquées dans l'ordre, sans erreur (versions 20261021094348, 20261021094414, 20261021094431).
- Nouvelles tables : `compensation_scale` (5 lignes), `regularity_rule` (3), `reference_prices` (2).
- Collecteur intact : `collector_state.last_error` nul avant et après ; exécutions `collect` de 09:46 et 09:48 réussies
  (après la dernière migration) ; événements 2 481 → 2 537, circulations 363 → 370 ; tâches `collect` et `purge` inchangées.

## Conseiller de sécurité Supabase

| Avant | Après |
|---|---|
| INFO `rls_enabled_no_policy` : `collector_state`, `events`, `stop_times_planned` | INFO `rls_enabled_no_policy` : `collector_state`, `events` |
| — | WARN `function_search_path_mutable` : `finished_margin`, `delay_bucket`, `circulation_finished` |

Aucune alerte ERROR. Les trois WARN sont attendus : fonctions pures sans accès aux tables, laissées sans
`search_path` pour permettre l'inlining. L'INFO sur `stop_times_planned` disparaît (politique de lecture ajoutée).

## Accès public (clé publique, REST)

| Requête | Résultat |
|---|---|
| `POST /rpc/stats_period` (20 → 21) | 200, 159 lignes |
| `POST /rpc/live_trains` | 200 |
| `GET /stop_times_planned?limit=1`, `/circulations`, `/circulation_measures` | 200, non vides |
| `GET /events?limit=1`, `GET /collector_state` | 200, `[]` |
| `GET /compensation_scale`, `/regularity_rule`, `/reference_prices` | 200, lignes du barème |
| `POST /compensation_scale`, `PATCH /compensation_scale`, `DELETE /reference_prices` | 401 (42501, permission refusée) |
| `POST /rpc/purge_events` | 401 (permission refusée) |
| `collector_apply`, `collector_context`, `collector_secret_ok`, `mark_removed` | pas de droit `execute` pour `anon` (vérifié par `has_function_privilege`) |

## Cohérence (étape 3)

`stats_period` (avec `p_now` = 2026-10-21 09:46 UTC) comparé à un recalcul indépendant écrit à la main sur
`trips_planned` et `circulations` (règles codées en dur, tranches recalculées) : **aucun écart sur les 159 lignes**
(par marque, axe et métrique, tranches au terminus et par arrêt comprises).

| Jour | prévus | observés | supprimés tard | jamais observés | annulés | sans terminus | ayant circulé | à l'heure (officiel) | Σ tranches terminus |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 | 544 | 75 | 0 | 469 | 2 | 2 | 71 | 39 | 71 |
| 2026-10-21 (en cours) | 123 | 123 | 0 | 0 | 2 | 1 | 120 | 85 | 120 |

Identités vérifiées pour chacun des 16 groupes (marque × axe × jour) : `prévus = observés + supprimés tard + jamais observés`,
`observés = annulés + sans terminus + ayant circulé`, Σ `terminus:*` = `ayant circulé`.

Contrôles à la main :

| Train | Durée prévue | Retard terminus | Seuil officiel | À l'heure | Tranche | Indemnité |
|---|---|---|---|---|---|---|
| INOUI 6260 (20/10) | 5 h 02 | 0 | < 15 min | oui | 0 | 0 % |
| INOUI 6117 (20/10) | 3 h 18 | 240 min | < 15 min | non | 180+ | 75 % (≥ 3 h 01) |
| OUIGO 7853 (20/10) | 6 h 03 | 130 min | < 15 min | non | 120-179 | 50 % (≥ 2 h) |
| INOUI 5182 (20/10) | 4 h 56 | 15 min | < 15 min | **non** (borne exclusive) | 15-29 | 0 % |
| INOUI 6132 (20/10) | 3 h 20 | 10 min | < 15 min | oui | 5-14 | 0 % |
| INOUI 6153 (20/10) | — | annulé | — | hors dénominateur | — | — |

Tous conformes aux règles en base.

## Performance (étape 4)

| Mesure | Temps |
|---|---|
| `explain analyze stats_period` 20 → 21, `p_now` réel | 19,6 ms |
| idem, `p_now` futur (tous les trajets comptés « terminés ») | 28,2 ms |
| 4 jours du référentiel (20 → 23, 2 440 trajets), `p_now` futur | 35,2 ms |
| REST anonyme, 2 jours (5 appels) | 0,10 à 0,15 s de bout en bout |
| REST anonyme, plage de 31 jours (09-23 → 10-23) | 0,11 à 0,18 s |
| `explain analyze live_trains()` | 55,5 ms ; REST 0,20 à 0,29 s |

Extrapolation à 31 jours pleins : ≈ 14 ms par jour (cas le plus lourd mesuré) × 31 ≈ **0,45 s**, soit environ
6 à 7 fois sous la limite de 3 s du rôle `anon`. Cette règle « durée par jour × 31 » suppose un coût proportionnel
à la plage ; en réalité il suit l'historique total (voir la réserve ci-dessous) : 0,45 s est un minorant, qui augmentera
avec la collecte.

**Réserve** : dans le plan, la jointure sur la vue `circulation_measures` n'est pas restreinte aux dates demandées
(parcours complet de `circulations`, filtre appliqué seulement après la jointure). Aujourd'hui sans effet
(370 lignes) ; le coût croîtra avec l'historique total, pas avec la plage. À remesurer après deux à quatre
semaines de collecte ; correction possible : calculer `on_time_official`, `bucket` et `comp_pct` directement
dans `stats_period` à partir de `t` et `c`, ou répéter le filtre de dates sur la vue.

## Taille de `live_trains` et de `/api/live`

À 09:47 UTC : 166 trains (dont 1 annulé et 29 pas encore partis, tous dans l'heure qui vient : l'horizon du flux),
1 000 arrêts.

| Mesure | Octets |
|---|---|
| `live_trains()::text` (jsonb, avec espaces) | 346 141 |
| REST sans compression | 346 141 |
| REST `Accept-Encoding: gzip` (et `gzip, deflate`, ce qu'envoie `fetch` de Node 24) | 62 397 (`content-encoding: gzip`) |
| REST `Accept-Encoding: br` | 29 841 |
| `/api/live` en local, JSON brut (170 trains, 1 018 arrêts) | 333 562 |
| idem compressé gzip -6 / brotli | 40 133 / 20 627 |

`next dev` ne compresse pas ; en production, Vercel compresse (gzip ou brotli selon le navigateur).
Répartition : le tableau `stops` pèse 66 % (227 Ko) ; dans les arrêts, `stop_id` 44 Ko, `arr` et `dep` 35 Ko chacun,
`name` 26 Ko, `cancelled` 18 Ko, `lat`/`lon` 31 Ko ; `cause` 17 Ko (27 textes distincts pour 62 trains), `trip_id` 17 Ko.

### Budget

Unités décimales : 1 Ko = 10^3 octets, 1 Go = 10^9 octets.

- **Transmis au navigateur** : ≈ 40 Ko (gzip) ou 21 Ko (brotli) ≤ 120 Ko : **tenu**. En brut, 334 Ko : au-delà,
  seulement pour un client qui refuse la compression.
- **Egress Supabase** (route `/api/live`, cache 60 s, ≈ 1 440 appels par jour au pire) :
  62,4 Ko × 1 440 × 30 ≈ **2,70 Go par mois** à 166 trains, pour un plafond fixé à 3 Go (5 Go pour tout le projet).
  Coût ≈ 0,376 Ko compressé par train : le plafond de 3 Go correspond à ≈ 185 trains en moyenne sur la journée.
  La moyenne réelle sera plus basse (nuit presque vide), mais l'heure de pointe peut dépasser 166 trains et
  le cache de Vercel est par région (plusieurs régions = plusieurs appels par minute). **Tenu, marge mince.**
- `/api/stats` : 6,1 Ko brut, 1,2 Ko compressé ; réponse Supabase de 31 jours : 10,9 Ko brut. Négligeable,
  sauf si les variantes de paramètres (`from`, `to`, `occupancy`) multiplient les entrées de cache : chaque variante
  rappelle Supabase, même quand seul `occupancy` change.
  **Corrigé après cette mesure** : `/api/stats` n'accepte plus que `period` (`7d`, `14d`, `31d`) ou `month` (`AAAA-MM`),
  l'occupation n'est plus un paramètre (réponse : `estimated_cost_eur_ht` à 0,75 et `cost_eur_ht_at_full_occupancy`),
  et `/api/live` refuse tout paramètre. Supabase est en outre protégé par le cache de données serveur de Next.js,
  indexé par la fenêtre validée (15 min pour les statistiques, 60 s pour le temps réel). Les requêtes avec `from`, `to` ou `occupancy` ci-dessous datent de l'ancienne API.

### Pistes d'allègement (non appliquées, à décider avant la carte)

1. Sortir les données statiques des arrêts (`name`, `lat`, `lon`, voire `stop_id` remplacé par un index) dans un
   fichier statique servi par Vercel (239 gares) : ≈ −100 Ko brut.
2. N'émettre `cancelled` que s'il est vrai, et `dep` seulement s'il diffère de `arr` : ≈ −40 Ko brut.
3. Dédupliquer `cause` (table des textes + indice) et raccourcir `trip_id` côté carte.

## Routes en local (étape 5)

| Requête | Statut | Cache-Control | Extrait |
|---|---|---|---|
| `/api/stats` (défaut : 2026-10-14 → 2026-10-20) | 200 | `public, s-maxage=900, stale-while-revalidate=300` | 71 ayant circulé, 39 à l'heure, régularité officielle **54,9 %**, coût estimé 115 008,15 € HT |
| `/api/stats?from=2026-10-20&to=2026-10-21` | 200 | idem | 194 ayant circulé, 127 à l'heure, **65,5 %**, 28 trains indemnisables, 149 014,50 € HT |
| `/api/stats?occupancy=7` | 400 | `no-store` | `{"error":"occupation invalide : nombre entre 0 et 1 attendu"}` |
| `/api/stats?from=2026-09-01&to=2026-11-01` | 400 | `no-store` | `{"error":"période limitée à 31 jours inclus (dates comprises)"}` |
| `/api/live` | 200 | `public, s-maxage=60, stale-while-revalidate=30` | 170 trains ; ex. INOUI 5300 Nantes → Montpellier, retard 140 min, 50 %, 23,30 € par passager (prix de référence) |

Contrôles : aucune valeur `NaN`, aucun `null` inattendu (seul `official_regularity_pct` peut l'être, et ne l'est pas ici),
taux entre 0 et 100, coûts ≥ 0, `comp_eur_per_passenger_ref` fini et ≥ 0 pour les 170 trains.
Calcul du coût vérifié : INOUI Sud-Est le 20/10, Σ pourcentages 325 → 3,25 × 46,60 × 556 × 0,75 = 63 154,65 € HT.

Plausibilité : les taux (55 % le 20 au soir, 66 % sur les deux jours) sont bas par rapport aux moyennes mensuelles
publiées, mais ces journées portent un incident majeur (panne d'un train de travaux sur la LGV Sud-Est, retards
jusqu'à 4 h) : Sud-Est 42,9 % et Intersecteurs 60 % tirent le total ; Atlantique 81,7 %. Ordre de grandeur cohérent.

## Points de décision

1. **Granularité du flux : 5 minutes.** Les 1 940 retards numériques observés sont tous des multiples de 300 s
   (retards d'arrêt : valeurs numériques de `circulations.stop_delays`, un par arrêt et par trajet, état courant ;
   les retards au terminus, `terminus_delay_s`, sont comptés à part : 356 sur 356 multiples de 300 s au contrôle suivant)
   (plus petites valeurs non nulles : 300 et 600). Conséquences : la tranche `1-4` reste vide par construction ;
   pour un trajet de moins de 1 h 30, « strictement moins de 5 min » signifie « retard publié 0 » ; le seuil INOUI
   « plus de 30 min » (1 860 s) ne se déclenche qu'à 35 min publiées. Le sens d'arrondi du flux (inférieur ou au plus
   proche) n'est pas connu : à documenter dans la méthodologie, ou à vérifier auprès de la source.
2. **Journée du 2026-10-20 incomplète** : 469 trajets sur 544 jamais observés parce que la collecte a commencé à
   20:07 UTC. Le tableau de bord ne devrait commencer qu'au 2026-10-21 (ou signaler la couverture partielle) ;
   la plage par défaut de `/api/stats` (7 jours jusqu'à la veille) l'inclut aujourd'hui.
3. **Coût de `stats_period` lié à l'historique total** (voir la réserve de performance) : à remesurer.
4. **Egress de `/api/live`** : marge d'environ 10 % sur le plafond de 3 Go ; allègement à trancher avant la carte.
5. `live_trains` inclut les trains pas encore partis (horizon du flux d'environ 1 h) : comportement à afficher
   comme tel sur la carte (position au départ, « pas encore parti »).
