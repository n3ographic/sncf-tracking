# Un train par numéro et par jour : dédoublonnage côté lecture

Date : 2026-10-27. Statut : design validé en conversation, à relire avant le plan.

## But

Compter chaque train une seule fois par jour de service dans les mesures, les statistiques et le flux live, quel que soit le nombre de variantes de `trip_id` créées par les réimports de l'horaire. Correction **côté lecture** : aucune ligne n'est supprimée ni modifiée, l'historique est recalculé.

## Constat (mesuré en lecture seule le 2026-10-27, jours 20 au 26 octobre)

- **Cause** : le dernier segment d'un `trip_id` est une date de variante (`…:20270114`). Le collecteur rattache le train du flux temps réel à la variante trouvée par `baseTripId` (la plus petite) tant que la nouvelle variante n'existe pas ; après le réimport de l'horaire, la jointure exacte l'emporte et un second `trip_id` apparaît (`supabase/functions/_shared/snapshot.ts`, `snapshotsFromFeed`). Le train en cours reçoit alors une seconde ligne dans `circulations`, l'ancienne variante (marquée `removed_at`) restant figée. Les secondes lignes naissent à l'instant du réimport : 09:32 le 22, 09:28 le 23, 09:16 le 24, 08:34 le 25, 08:46 le 26 (heure de Paris).
- **Ampleur** : 114 circulations en trop sur 3 648 circulées (3,1 %) ; 113 sur 114 sont la variante retirée ; leur retard diffère de la copie finale dans 60 cas, leur verdict de régularité dans 27 ; 225 points de pourcentage d'indemnité en trop sur 15 600 (1,4 %), environ 43 700 € HT sur 2,99 M€.
- **Trajets prévus** : `trips_planned` compte 899 lignes pour 610 numéros le 27 octobre (833/595 le 25, 909/617 le 26). Les copies retirées gonflent `planned` et `removed_late`, d'où un COUV d'environ 72 % alors que la couverture par numéro est probablement proche de 100 %.
- **Live** : 6 numéros sont en double dans `live_trains()` sur 166 trains au moment de la mesure.
- **Clé** : sur les 1 892 paires de trajets de même numéro le même jour (21 au 29 octobre), les horaires se chevauchent toujours : `(service_date, train_number)` identifie un seul train physique. Aucun cas où une copie est annulée et l'autre circulée n'a été trouvé.

## Définitions

Deux vues, créées dans une migration (`security_invoker = true`) :

- **`public.canonical_trips`** : une ligne de `trips_planned` par `(service_date, train_number)`. Ordre de préférence : `removed_at is null` d'abord, puis `last_import_at` le plus récent, puis `trip_id` le plus petit (choix déterministe).
- **`public.canonical_circulations`** : une ligne de `circulations` par `(service_date, train_number)`, celle dont `last_seen_at` est le plus récent (celle qui porte le retard final), puis `trip_id` le plus petit. Les horaires se lisent dans la circulation elle-même (`arr_planned`) et dans son propre trajet prévu (`dep_planned`), jamais dans la variante retirée d'une autre copie.

Index : `(service_date, train_number)` sur `trips_planned` et sur `circulations`.

## Objets remplacés (mêmes colonnes, même ordre)

- **`circulation_measures`** : part de `canonical_circulations` (au lieu de `circulations`), jointe à son propre `trips_planned` par `trip_id` pour la durée prévue, la marque et l'axe. Un train = une ligne.
- **`stats_period`** : la base devient `canonical_trips t left join canonical_circulations c on (service_date, train_number)` ; `m` se joint sur `c.trip_id`. Le critère « terminé » utilise `c.arr_planned` lorsqu'une circulation existe, `t.arr_planned` sinon. Mesures de sortie inchangées (dont `cause:`, `cause_delay_s:`, `cause_comp:`).
- **`live_trains(p_now)`** : parcourt `canonical_circulations` ; le reste de la réponse est inchangé (fenêtre de 3 arrêts, `comp_pct`, `cause` tronquée).

Inchangés : le collecteur, l'import de l'horaire, la table `circulations`, `cumul_totals` (il lit `daily_stats`), les fonctions `snapshot_day` et `snapshot_recent`, l'API et l'écran (même forme de réponse : pas de nouvelle clé de cache).

## Historique

À la fin de la migration : `snapshot_day(d)` pour chaque jour du `2026-10-20` à la veille (Paris), comme la migration `20261027000001`.

## Effets attendus (à confirmer par l'aperçu avant la production)

- Circulées : −114 (−3,1 %) ; indemnités : environ −44 k€ HT ; régularité : légèrement corrigée (27 verdicts concernés).
- `planned` ne compte plus qu'un trajet par numéro : COUV proche de 100 % (les trains réellement retirés restent comptés une fois).
- Plus de numéro en double dans `live_trains()`.

## Tests

- **SQL** (harnais PGlite, migration ajoutée à `MIGRATIONS_UNDER_TEST`) :
  - un numéro avec deux variantes (la retirée figée à 300 s, la présente à 600 s) : 1 train circulé, retard final 600 s, une seule indemnité, `planned = 1`, `observed = 1` ;
  - un train sans doublon : mesures identiques à celles d'avant ;
  - deux copies annulées : 1 annulation ; jours différents : pas de fusion ;
  - `live_trains` ne renvoie qu'une ligne pour un numéro à deux variantes ;
  - les jeux de données de `tests/measures.test.ts` et `tests/range-measures.test.ts` donnent les mêmes résultats (régression) ;
  - `canonical_trips` choisit la variante présente, puis la plus récente.
- **Aperçu sur les vraies données**, en lecture seule, avant la migration : mêmes calculs écrits en requête simple, écart annoncé sur circulées, régularité, indemnités, COUV.
- **Après la production** : `/api/stats?period=7d`, `/api/cumul` et l'écran ; contrôle que `live_trains()` n'a plus de numéro en double.

## Mise en production

Séquence habituelle, chaque étape avec accord explicite : migration, puis code (méthodologie), puis vérification. Le code web ne dépend pas de la migration (réponses de même forme).

## Méthodologie

Une phrase ajoutée : « un train est identifié par son numéro et son jour de service ; les variantes de l'horaire créées par les réimports ne comptent qu'une fois ». Le point « COUV » est expliqué sur la page (part des trains prévus effectivement observés).

## Hors périmètre

- Corriger la cause à la source (rattacher la circulation en cours à la nouvelle variante pendant l'import) : chantier à part, il modifie des données.
- Supprimer les lignes en trop de `circulations` ou de `trips_planned`.
- Les rames couplées (numéros distincts, non concernées).
- Changer la définition de « COUV » ou son libellé.
