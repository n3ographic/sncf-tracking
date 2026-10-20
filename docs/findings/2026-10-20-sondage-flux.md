# Sondage des flux GTFS-RT SNCF — 2026-10-20

Script : `scripts/inspect-feed.ts` (`npm run inspect`). Deux passages : 19:32 UTC (21:32 Paris) et 19:43 UTC (21:43 Paris).
GTFS statique : `Export_OpenData_SNCF_GTFS_NewTripId.zip`, `feed_version` 2026-10-19, validité 20261019 → 20270331.

## Résumé (valeurs à reprendre dans les tâches suivantes)

| Question | Réponse |
|---|---|
| OUIGO présent dans Trip Updates ? | **Oui** (14 trajets OUIGO sur 110 TGV au 1er passage) → pas de plan B Navitia |
| Jointure GTFS-RT ↔ statique (TGV) | **100 %** (110/110) par égalité stricte de `trip_id` |
| Jointure globale (tous trains) | 86,4 % ; les 13,6 % restants sont des trajets `ADDED` (id court, aucun TGV) |
| `delay` ou `time` ? | **Les deux**, toujours ensemble, sur `arrival` et `departure` |
| `stop_sequence` dans le flux ? | **Non**, seulement `stop_id` (StopPoint) → jointure par `stop_id` |
| Lien alertes ↔ trajets | `informed_entity.trip.trip_id` au **format court** `OCESN<numéro>F` |
| Volume estimé d'events | ~3 200/jour au rythme du soir ; **3 000 à 10 000/jour** en fourchette (voir plus bas) |

## BRAND_RULES

Toutes les circulations sont sous l'agence `1187` (SNCF VOYAGEURS) ; l'agence et le `route_type` (2) ne distinguent rien.
La marque se lit dans le **2e segment du `trip_id`** (séparateur `:`) :

```
OCESN5537F1187_F:OUI:FR:Line::19ea029b-…::87141002:87756056:18:2243:20261115   → INOUI
OCESN7853F1187_F:OGO:FR:Line::D1E5AD07-…::87686006:87756056:7:2213:20261212    → OUIGO
```

- `:OUI:` → `INOUI` (10 249 trajets au statique) ; `:OGO:` → `OUIGO` (653 trajets).
- Autres codes ignorés : `TER`, `CTE` (car), `IC`, `ICN`, `ICE`, `LYR` (Lyria), `TT`, `CRE`, `NAV`, `TRN`.
- Cohérence vérifiée : 100 % des `stop_times` des trajets `:OUI:` utilisent des `stop_id` `StopPoint:OCETGV INOUI-<UIC>`, et 100 % des `:OGO:` des `StopPoint:OCEOUIGO-<UIC>`. Le préfixe de `stop_id` est donc une règle équivalente (utile pour le flux RT, qui ne contient pas `route_id`).
- **Attention OUIGO Train Classique** : 81 trajets `:OGO:` ont un numéro en `40xx` (routes `434A` Paris - Nantes, `434C` Paris - Rennes, et 9 sur la route `OCEdefault`/« INCONNU », Paris-Austerlitz → Bordeaux). Ce ne sont pas des TGV. Les TGV OUIGO sont numérotés `76xx`, `77xx`, `78xx`. Règle proposée : `OUIGO` si `:OGO:` et numéro de train ∉ [4000, 4999] — **à trancher par l'auteur** (inclure ou exclure le Train Classique).
- Numéro de train = chiffres après `OCESN` dans le `trip_id` (`OCESN5537F…` → 5537).

## Format de `trip_id` et jointure

- Format statique (NewTripId) : `OCESN<numéro>F<agence>_F:<code>:<route_id>::<UIC départ>:<UIC arrivée>:<nb arrêts>:<HHMM arrivée>:<date AAAAMMJJ>`. La date finale n'est **pas** la date de circulation : le même `trip_id` sert pour tout un `service_id` (calendar_dates) ; elle sert seulement à rendre l'id unique.
- Le flux RT reprend exactement le `trip_id` statique pour les trajets planifiés ; la date de circulation est dans `trip.start_date` (AAAAMMJJ), avec `trip.start_time`. Clé `${start_date}|${trip_id}` conforme au plan.
- Trajets `ADDED` (`trip.schedule_relationship = ADDED`, 98 au 1er passage) : id court (`OCESN29956F`, `OCESN79056R`…), `stop_id` au format `StopArea:OCE<UIC>`, injoignables au statique. Numéros à 3, 5, 6 ou 8 chiffres (cars, TER, trains de substitution) : aucun TGV parmi eux.

## Trip Updates

- Protobuf ~570 Ko, `gtfs_realtime_version` 2.0, `header.timestamp` renouvelé toutes les ~94 s (1792524717 → 1792524811 → 1792524905) ; deux appels rapprochés renvoient le même timestamp (cas `skipped: 'stale'` de la Task 5).
- 1er passage : 718 `trip_update`, dont **110 TGV (96 INOUI, 14 OUIGO)**. Le statique prévoit 617 TGV ce jour (548 INOUI, 69 OUIGO) : le flux ne contient que les trajets en cours ou proches (fenêtre glissante) ; un trajet disparaît du flux une fois terminé (4 disparus en 2 min). **Le collecteur doit donc capter le retard au terminus avant la disparition** — avec un cycle de 2 min c'est le cas, mais un trajet jamais vu dans le flux n'aura aucune ligne.
- `stop_time_update` : 692 pour les TGV ; `arrival.delay` + `arrival.time` présents ensemble (579), `departure.delay` + `departure.time` ensemble (580). Le premier arrêt n'a que `departure`, le terminus que `arrival`, et ponctuellement un arrêt n'a que `departure`. `time` = heure prévue + `delay` (vérifié sur les 3 trajets de la fixture). **On utilise `delay` ; le repli `time − arr_planned` n'est jamais nécessaire en pratique**, mais on le garde (cas de test synthétique pour la Task 5).
- `trip_update.delay` : jamais renseigné. `trip_update.timestamp` : toujours.
- `stop_sequence` : **jamais** renseigné. `stop_id` : toujours, au format `StopPoint:OCETGV INOUI-<UIC>` / `StopPoint:OCEOUIGO-<UIC>`, identique au statique. Aucun TGV ne passe deux fois au même `stop_id` → la correspondance `stop_id → stop_sequence` via `stop_times.txt` est sûre.
- Sur 100 des 110 TGV, la liste des arrêts RT est identique (mêmes ids, même ordre) à `stop_times`. Les 10 autres ont 1 ou 2 **arrêts ajoutés** en `StopArea:OCE<UIC>` (ex. `StopArea:OCE87703975`, `StopArea:OCE87688887`, détournements) : absents du plan, à ignorer (pas de `stop_sequence` ni d'heure prévue).
- `schedule_relationship` arrêt : 653 `SCHEDULED`, 39 `SKIPPED` (arrêt supprimé). Trajet : 107 `SCHEDULED`, **3 `CANCELED`** ; un trajet `CANCELED` a tous ses arrêts en `SKIPPED` (avec un `delay` qui reste renseigné et ne doit pas compter).
- protobufjs : les champs absents renvoient leur valeur par défaut via le prototype (`delay` = 0). Tester la présence avec `Object.hasOwn(obj, 'delay')`, pas `!= null`.

## Service Alerts

- Protobuf ~715 Ko, 343-345 entités (`QOM:Broadcast::<id>:LOC`), traductions `fr` toujours, `en/de/es/it/nl` pour ~78 %.
- `informed_entity` : 6 300 `{trip}`, 240 `{trip, stop_id}`, 2 `{stop_id}` ; **jamais de `route_id`**.
- `informed_entity.trip.trip_id` est au **format court** `OCESN<numéro><F|R>` (4 540 ids distincts), soit le préfixe du `trip_id` long jusqu'à la lettre qui suit le numéro : `OCESN6153F` ↔ `OCESN6153F1187_F:OUI:…`. Regex : `/^OCE[A-Z]+\d+[A-Z]/`. Égalité stricte avec un `trip_id` TU : 2/4 540 (des `ADDED`). Avec l'id court : **35 TGV sur 110** visés par au moins une alerte.
- Le suffixe `R` (1 055 ids) correspond aux codes `CTE`/`CRE` (cars) ; tous les trains, dont les TGV, sont en `F` (vérifié sur `trips.txt`).
- Pas de `start_date` dans `informed_entity` : l'alerte vise le numéro de train ; on la rattache au trajet du jour via `active_period`.
- `cause` : 1 (UNKNOWN), 2 (OTHER), 9 (MAINTENANCE) ; `effect` toujours 8 (UNKNOWN_EFFECT). La cause utile est en texte dans `description_text` (HTML, « `<p>Cause : …</p>` ») ; `header_text` est un titre court (« Votre train est retardé. »).

## GTFS statique : arrêts, calendrier

- `stop_id` en deux niveaux : `StopArea:OCE<UIC>` (`location_type` 1) et `StopPoint:OCE<mode>-<UIC>` (`location_type` 0, `parent_station` = StopArea). `stop_times` n'utilise que des StopPoint. Modes : `TGV INOUI`, `OUIGO`, `Train TER`, `Car TER`, `INTERCITES`, `ICE`, `Lyria`, etc.
- Noms exacts des gares parisiennes (identiques StopArea et StopPoint) :
  - Paris Nord : `Paris Gare du Nord` (UIC 87271007, INOUI seulement)
  - Gare de Lyon : `Paris Gare de Lyon Hall 1 - 2` (87686006, INOUI et OUIGO)
  - Bercy : `Paris Bercy Bourg. Pays d'Auv.` (87686667, pas de StopPoint TGV)
  - Montparnasse : `Paris Montparnasse Hall 1 - 2` (87391003, INOUI et OUIGO) et `Paris Montparnasse Vaugirard` (87391102, INOUI)
  - Est : `Paris Est` (87113001, INOUI et OUIGO)
  - Austerlitz : `Paris Austerlitz` (87547000, OUIGO Train Classique)
  - Hors Paris : `Marne-la-Vallée Chessy` (87111849), `Massy TGV` (87393702), `Aéroport Charles de Gaulle 2 TGV` (87271494).
  → Pour l'axe, utiliser l'**UIC** plutôt que le nom.
- Calendrier : **pas de `calendar.txt`**, uniquement `calendar_dates.txt` (9 212 `service_id`, 209 416 lignes, toutes `exception_type = 1`). Un trajet circule à la date D si `(service_id, D)` y figure.
- `stop_times` : heures au-delà de 24:00 possibles (219 lignes TGV `>= 24:00:00`) ; `stop_sequence` commence à 0.
- Fichiers du zip : agency, calendar_dates, feed_info, routes, stop_times (82 Mo décompressé), stops, transfers (vide), trips. Zip : 5,4 Mo.

## Estimation du volume d'`events`

Méthode : `inspect-feed.ts` compare le snapshot courant au plus récent snapshot d'au moins 9 min plus ancien, au grain des `EventKind` de la Task 3 (retard par arrêt, arrêt supprimé, suppression/rétablissement, alerte ajoutée/retirée, trajet nouveau).

| Passage | TU (trip_update) | TGV (INOUI/OUIGO) | CANCELED | arrêts TGV | alertes | TGV visés par une alerte |
|---|---|---|---|---|---|---|
| 19:32 UTC | 718 | 110 (96/14) | 3 | 692 | 345 | 35 |
| 19:43 UTC | 649 | 103 (89/14) | 3 | 659 | 339 | 44 |

Changements TGV entre les snapshots `header.timestamp` 1792524811 → 1792525374 (563 s) :
`first_seen 0, delay 10, stop_cancelled 0, cancelled 0, uncancelled 0, alert_added 10, alert_removed 1` → **21 events en 9,4 min**, 6 trajets sortis du flux. Sur 2,5 min (essai) : 3 events.

Extrapolation brute : 21 × 86 400 / 563 ≈ **3 200 events/jour**. Ce rythme est mesuré un soir (21:35-21:43 Paris) avec ~105 TGV dans le flux ; en journée, davantage de TGV circulent en même temps, et chaque trajet du jour (617 TGV prévus) produit au moins un `first_seen` plus ses retards initiaux. Fourchette retenue : **3 000 à 10 000 events/jour**, soit au plus ~300 000 lignes sur 30 jours glissants — compatible avec le palier gratuit Supabase (500 Mo). À recaler avec le volume horaire réel mesuré en Task 5, Step 7.

## Fixtures pour la Task 5

`tests/fixtures/trip-updates.json` et `tests/fixtures/service-alerts.json` : `FeedMessage.toObject(msg, { longs: String })` (enums numériques, champs absents omis) du snapshot 19:33:24 UTC, avec l'en-tête d'origine et 3 entités. `start_date` = `20261020` pour les trois.

1. `OCESN5537F…:OUI:…` (INOUI Nancy → Nice) : `delay` et `time` sur 18 arrêts, retard 4 200 s à partir de l'arrêt 1, pas d'alerte.
2. `OCESN6153F…:OUI:…` (INOUI Paris-Lyon → Marseille) : `CANCELED`, 3 arrêts `SKIPPED`, visé par l'alerte `QOM:Broadcast::1024865877515074777:LOC` (maintenance).
3. `OCESN7853F…:OGO:…` (OUIGO Paris-Lyon → Nice) : 2 premiers arrêts `SKIPPED`, retard 5 400 s ensuite, l'arrêt Marseille n'a que `departure`, visé par l'alerte `QOM:Broadcast::3926910641521586324:LOC` (crues à Toulon).

Aucune entité ne porte `time` sans `delay` : pour le test « `time` sans `delay` », retirer `delay` d'une copie de la fixture.

Horaires prévus (`stop_times.txt`, heure locale Europe/Paris le 2026-10-20 ; `stop_sequence`, `stop_id`, arrivée, départ) :

**OCESN5537F1187_F:OUI:FR:Line::19ea029b-6782-421a-8481-7470f5718e47::87141002:87756056:18:2243:20261115** (service 000214)

| seq | stop_id | arr | dep |
|---|---|---|---|
| 0 | StopPoint:OCETGV INOUI-87141002 | 12:26:00 | 12:26:00 |
| 1 | StopPoint:OCETGV INOUI-87212027 | 13:29:00 | 13:37:00 |
| 2 | StopPoint:OCETGV INOUI-87182014 | 14:03:00 | 14:06:00 |
| 3 | StopPoint:OCETGV INOUI-87182063 | 14:37:00 | 14:41:00 |
| 4 | StopPoint:OCETGV INOUI-87300822 | 15:03:00 | 15:07:00 |
| 5 | StopPoint:OCETGV INOUI-87300863 | 15:30:00 | 15:36:00 |
| 6 | StopPoint:OCETGV INOUI-87713040 | 16:04:00 | 16:17:00 |
| 7 | StopPoint:OCETGV INOUI-87713545 | 16:37:00 | 16:40:00 |
| 8 | StopPoint:OCETGV INOUI-87723197 | 17:59:00 | 18:06:00 |
| 9 | StopPoint:OCETGV INOUI-87318964 | 19:08:00 | 19:11:00 |
| 10 | StopPoint:OCETGV INOUI-87319012 | 19:32:00 | 19:35:00 |
| 11 | StopPoint:OCETGV INOUI-87751008 | 19:47:00 | 20:01:00 |
| 12 | StopPoint:OCETGV INOUI-87755009 | 20:44:00 | 20:48:00 |
| 13 | StopPoint:OCETGV INOUI-87755447 | 21:28:00 | 21:31:00 |
| 14 | StopPoint:OCETGV INOUI-87757526 | 21:45:00 | 21:48:00 |
| 15 | StopPoint:OCETGV INOUI-87757625 | 22:10:00 | 22:14:00 |
| 16 | StopPoint:OCETGV INOUI-87757674 | 22:22:00 | 22:25:00 |
| 17 | StopPoint:OCETGV INOUI-87756056 | 22:43:00 | 22:43:00 |

**OCESN6153F1187_F:OUI:FR:Line::BAF1DE9A-72EC-4064-8BE9-C4EFF292CB6A::87686006:87755009:3:2210:20261211** (service 003537)

| seq | stop_id | arr | dep |
|---|---|---|---|
| 0 | StopPoint:OCETGV INOUI-87686006 | 18:10:00 | 18:10:00 |
| 1 | StopPoint:OCETGV INOUI-87751008 | 21:13:00 | 21:27:00 |
| 2 | StopPoint:OCETGV INOUI-87755009 | 22:10:00 | 22:10:00 |

**OCESN7853F1187_F:OGO:FR:Line::D1E5AD07-58C1-456A-B4E2-928E91061B0B::87686006:87756056:7:2213:20261212** (service 004699)

| seq | stop_id | arr | dep |
|---|---|---|---|
| 0 | StopPoint:OCEOUIGO-87686006 | 16:10:00 | 16:10:00 |
| 1 | StopPoint:OCEOUIGO-87763029 | 18:23:00 | 18:28:00 |
| 2 | StopPoint:OCEOUIGO-87755009 | 20:11:00 | 20:15:00 |
| 3 | StopPoint:OCEOUIGO-87755447 | 20:52:00 | 20:55:00 |
| 4 | StopPoint:OCEOUIGO-87757625 | 21:32:00 | 21:36:00 |
| 5 | StopPoint:OCEOUIGO-87757674 | 21:47:00 | 21:51:00 |
| 6 | StopPoint:OCEOUIGO-87756056 | 22:13:00 | 22:13:00 |

Conversion : `2026-10-20` est en heure d'été (UTC+2) ; ex. arrivée prévue seq 1 de 5537F = `2026-10-20T11:29:00Z`, et `arrival.time` RT = 1792495740 = `2026-10-20T11:29:00Z` avec `delay` 0.

## Conséquences pour les tâches suivantes

- Task 3 (`brandOf`) : règle `:OUI:` / `:OGO:` sur le `trip_id` (+ décision sur OUIGO Train Classique 40xx).
- Task 4 (import statique) : lire `calendar_dates.txt` (pas de `calendar.txt`) ; produire `arrPlanned` indexé par `stop_sequence` **et** garder `stop_id → stop_sequence`, car le flux RT ne donne que `stop_id` ; gérer les heures ≥ 24:00.
- Task 5 (`snapshotsFromFeed`) : retard = `arrival.delay` (sinon `departure.delay`), présence testée avec `Object.hasOwn` ; ignorer les arrêts `StopArea:` ajoutés ; `SKIPPED` → `'cancelled'` ; `CANCELED` → `cancelled: true` ; alertes rattachées par id court `OCESN<numéro>F` ; `cause` depuis `description_text` fr.
