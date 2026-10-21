# Observatoire TGV

Observatoire indépendant de la ponctualité des TGV INOUI et OUIGO, construit à partir des données ouvertes temps réel.

**Projet indépendant, non affilié à SNCF ni à OUIGO.**

Périmètre : TGV INOUI et TGV OUIGO. Les OUIGO Train Classique (numéros 4000 à 4999) sont exclus pour l'instant.

## Sources et licence

- GTFS-RT SNCF, Trip Updates et Service Alerts, via [transport.data.gouv.fr](https://transport.data.gouv.fr) ;
- GTFS statique SNCF (`Export_OpenData_SNCF_GTFS_NewTripId.zip`, SNCF Open Data) pour les horaires théoriques.

Ces données sont sous licence [ODbL 1.0](data/LICENSE-ODbL.txt). Contient des informations de SNCF Open Data et de transport.data.gouv.fr, sous licence ODbL.

## Données publiées

Chaque mois, le journal des événements du mois précédent (heure de Paris) est publié en CSV gzip dans les [Releases](../../releases) du dépôt, sous le tag `events-AAAA-MM`, sous licence ODbL. Une ligne est un changement observé sur un trajet :

| Colonne | Contenu |
|---|---|
| `id` | identifiant croissant de l'événement |
| `observed_at` | instant d'observation (horodatage du flux) |
| `service_date` | date de circulation |
| `trip_id` | identifiant du trajet dans le GTFS SNCF |
| `kind` | `first_seen`, `delay`, `stop_cancelled`, `cancelled`, `uncancelled`, `alert_added`, `alert_removed` |
| `stop_sequence` | rang de l'arrêt concerné (vide pour un événement de trajet) |
| `value` | détail JSON : `delay_s` et `from_s` (retard en secondes, nouveau et précédent ; `from_s` vide si inconnu), `was_cancelled: true` quand un arrêt supprimé redevient desservi, `alert_id` |

Volume mesuré : 427 événements pendant la première heure de collecte réelle, le mardi 20 octobre 2026 entre 22 h 07 et 23 h 05 (heure de Paris : soirée, trafic décroissant). Le volume d'une journée complète reste à mesurer.

## Architecture

1. `pg_cron` appelle toutes les 2 min l'Edge Function Supabase `collect`, authentifiée par un secret stocké dans Vault.
2. `collect` lit les deux flux GTFS-RT, ne garde que les TGV et calcule les changements depuis l'observation précédente.
3. La RPC `collector_apply` les écrit en une transaction : table `events` (journal append-only, conservé 30 jours) et table `circulations` (état courant de chaque trajet).
4. GitHub Actions importe chaque nuit le GTFS statique pour J, J+1 et J+2 (`import-static.yml`). Aucun trajet n'est supprimé : un trajet retiré du GTFS (souvent une suppression tardive) reste dans `trips_planned` avec `removed_at` renseigné, pour que sa suppression dans le flux temps réel soit encore enregistrée.
5. GitHub Actions exporte chaque mois le journal en Release (`export-month.yml`) ; la purge quotidienne ne supprime que des mois déjà exportés, jamais un mois non exporté.

Le schéma est dans `supabase/migrations/`, le code partagé dans `supabase/functions/_shared/`.

## API publique

Deux routes en lecture seule (Next.js, dossier `web/`), qui ne lisent la base qu'avec la clé publique.

### `GET /api/stats`

Statistiques par marque et par axe sur une période de jours de service. Un seul paramètre au plus :

| Paramètre | Valeurs | Période |
|---|---|---|
| `period` | `7d` (défaut), `14d`, `31d` | les n derniers jours, jusqu'à la veille (heure de Paris) |
| `month` | `AAAA-MM`, de `2026-10` au mois courant | le mois, jusqu'à aujourd'hui pour le mois en cours |

Tout autre paramètre, une valeur hors liste ou les deux paramètres ensemble donnent une erreur `400`.

Réponse : `from`, `to`, `groups` (un objet par marque et axe, avec `brand` et `axis`), `totals` (mêmes champs, tous groupes confondus) et `assumptions` (`occupancy`, `prices`, `compensation_scale`, avec leurs sources). Champs d'un groupe :

- comptes : `planned`, `observed`, `removed_late`, `never_observed`, `cancelled`, `no_terminus`, `circulated`, `on_time_official`, `comp_eligible`, `comp_pct_sum` ;
- `official_regularity_pct` : `on_time_official / circulated × 100`, `null` si aucun train n'a circulé ;
- `terminus_buckets` (tranches `0`, `1-4`, `5-14`, `15-29`, `30-59`, `60-119`, `120-179`, `180+` min) et `stop_buckets` (mêmes tranches plus `cancelled`) ;
- `estimated_cost_eur_ht` : coût estimé des indemnités, en euros HT, à l'occupation de référence 0,75 (`assumptions.occupancy`) ;
- `cost_eur_ht_at_full_occupancy` : même coût avec des rames pleines. Le coût est proportionnel à l'occupation : pour une autre hypothèse, le client calcule `coût = cost_eur_ht_at_full_occupancy × occupation`.

Cache : `public, s-maxage=900, stale-while-revalidate=300` (15 min).

### `GET /api/live`

Aucun paramètre (tout paramètre donne une erreur `400`). Trains en circulation (jour de service courant ou veille, pas encore terminés). Réponse : `generated_at` et `trains`. Clés d'un train : `trip_id`, `service_date`, `brand`, `axis`, `train_number`, `cancelled`, `dep_planned`, `arr_planned`, `origin` et `dest` (noms), `delay_s` et `last_seq` (dernier arrêt portant un retard), `cause` (160 caractères au plus), `comp_pct`, `comp_eur_per_passenger_ref` (indemnité par voyageur, `comp_pct` appliqué au prix de référence HT), `last_seen_at`, `stops`. Les valeurs nulles sont omises. `stops` ne contient que le dernier arrêt portant un retard et le suivant (les deux premiers arrêts si aucun retard n'est connu). Clés d'un arrêt : `seq`, `name`, `lat`, `lon` (3 décimales), `arr`, `dep`, `delay_s`, `cancelled` (présent seulement s'il est vrai).

Un `dep_planned` dans le futur désigne un train annoncé par le flux mais pas encore parti.

Cache : `public, s-maxage=180, stale-while-revalidate=60` (3 min : le collecteur ne passe que toutes les 2 min).

### Erreurs

`400` pour des paramètres invalides, `502` quand la base est indisponible ; corps `{"error": "…"}`, jamais mis en cache (`Cache-Control: no-store`).

### Définitions et limites

Les règles vivent en base (tables `regularity_rule`, `compensation_scale`, `reference_prices`), lisibles publiquement.

- **Régularité officielle** (méthode de data.gouv.fr « Régularité mensuelle TGV par liaisons ») : un train est à l'heure si son retard au terminus est strictement inférieur à 5 min (trajet de moins de 1 h 30), 10 min (de 1 h 30 à 3 h) ou 15 min (plus de 3 h). Les suppressions sont exclues du dénominateur.
- **Mesure brute** : suppressions comptées comme des échecs ; distribution des retards par tranche, au terminus et à chaque arrêt.
- **Barème INOUI** (page SNCF Voyageurs « TGV INOUI - INTERCITÉS », mise à jour le 2026-06-17, lue le 2026-10-21) : plus de 30 min → 25 %, de 2 h à 3 h → 50 %, au-delà de 3 h → 75 %.
- **Barème OUIGO** (page SNCF Voyageurs « OUIGO », mise à jour le 2026-09-04, lue le 2026-10-21) : de 1 h à 1 h 59 → 25 %, 2 h et plus → 50 %.
- **Coût estimé** = Σ (pourcentage / 100 × prix de référence × capacité × occupation). Prix moyen HT par marque (FNAUT d'après l'ART, 2023 : INOUI 46,60 €, OUIGO 34,20 €) ; capacité d'une rame (INOUI 556, OUIGO 634 places), plancher ; occupation de référence 0,75, **hypothèse non sourcée** (voir `cost_eur_ht_at_full_occupancy` pour en changer).
- **Suppressions** : comptées, sans montant.
- **`circulated`** : train terminé, non annulé, dont le retard au terminus est connu. Les `no_terminus` (terminés sans retard au terminus connu) ne comptent ni au numérateur ni au dénominateur de la régularité.
- **`removed_late`** : trajet prévu, jamais vu dans le flux temps réel, puis retiré du GTFS statique (suppression tardive probable). **`never_observed`** : trajet prévu, jamais vu dans le flux et toujours présent au GTFS. **`comp_eligible`** : trains ayant circulé dont le retard au terminus ouvre droit à une indemnité selon le barème de leur marque ; `comp_pct_sum` est la somme de leurs pourcentages.
- **Tranches et barème** : les tranches `30-59` et `180+` commencent une minute avant les seuils INOUI de 25 % et 75 % (31 min et 3 h 01). Un train de la tranche `30-59` n'est donc pas forcément indemnisé : seul `comp_eligible` le dit.
- **Train terminé** : annulé, ou arrivée prévue + retard au terminus + 30 min dépassée. Seuls les trains terminés entrent dans `/api/stats`.
- **Pas de 5 minutes** : les retards du flux GTFS-RT sont tous des multiples de 5 min. « À l'heure » sous 5 min équivaut donc à un retard publié de 0, la tranche `1-4` reste vide et le seuil INOUI n'est franchi qu'à 35 min publiées ; le sens de l'arrondi est inconnu. La régularité calculée est une approximation, à calibrer sur la régularité officielle mensuelle : ne pas la comparer aux chiffres officiels avant ce calibrage.
- **Taille du cache de données** : Next.js n'y garde que des éléments de 2 Mo au plus ; la réponse brute de `/api/live` fait environ 350 Ko aujourd'hui, à garder très en dessous (allègement du plan 3).
- **Couverture** : la collecte a commencé le 2026-10-20 à 22 h 07 (heure de Paris) ; ce jour de service n'est couvert que partiellement, et toute panne du collecteur en ferait autant. `never_observed` (trajets prévus jamais vus dans le flux) rend la couverture visible.

### Coûts et configuration

Le site n'utilise que la clé publique (`SUPABASE_ANON_KEY`), soumise aux droits du rôle `anon`. Projet Vercel : racine `web`, variables `SUPABASE_URL` et `SUPABASE_ANON_KEY`. Supabase est protégé par un cache de données côté serveur (Data Cache de Next.js), indexé par la fenêtre validée : une lecture au plus par fenêtre toutes les 15 min pour `/api/stats`, une par minute pour `/api/live`, quelle que soit l'écriture de l'URL. Une erreur n'y est jamais mémorisée. Les en-têtes `Cache-Control` ci-dessus servent le CDN, qui peut garder plusieurs variantes d'une même URL ; ces variantes ne rappellent pas Supabase. Egress mesuré dans `docs/findings/2026-10-21-mesures-reelles.md`.

## Carte

La page d'accueil affiche les TGV en circulation (MapLibre GL, fond OpenFreeMap, données OpenStreetMap). Un point par train, vert à l'heure, orange à partir de 5 min de retard, rouge à partir de 30 min, gris si annulé. Un clic ouvre le trajet, le retard, la cause et l'indemnité théorique par voyageur. Filtres par marque et par axe, compteur de trains en retard. La page lit `/api/live` toutes les minutes.

**Les positions sont estimées, pas mesurées.** Entre le dernier arrêt portant un retard et le suivant, le train avance en ligne droite, à retard constant, depuis son départ corrigé jusqu'à son arrivée corrigée. Un train dont le dernier passage du collecteur date de plus de 10 min est estompé (« donnée périmée »). Entre deux arrêts, le train suit le tracé des voies (fichier `web/public/trace-paires.json`, précalculé par `npm run build:traces` à partir du fichier de formes des lignes de SNCF Réseau, plus court chemin sur le graphe des lignes) ; sans tracé connu pour la paire d'arrêts (gare hors du jeu, détour jugé aberrant, nouvelle paire après un changement de plan de transport), il avance en ligne droite. Le fichier de tracés est une base dérivée, sous licence ODbL : contient des informations de SNCF Réseau, sous licence ODbL.

## Tableau de bord

La page `/tableau` lit `/api/stats` : régularité officielle approchée, taux de suppression, répartition des retards au terminus et indemnités théoriques, par marque et par axe, sur 7, 14 ou 31 jours ou un mois. Chaque chiffre porte son effectif ; en dessous de 30 trains ayant circulé il est estompé (« échantillon trop petit »). Les causes de retard ne sont pas encore affichées.

## Développement

Node 24 requis.

```sh
npm install
npm test               # tests unitaires et tests SQL en mémoire (vitest, PGlite)
npm run inspect        # sondage des flux GTFS-RT et du GTFS statique
npm run import:static  # import du GTFS statique, lit SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
```

Les migrations s'appliquent dans l'ordre des fichiers ; la dernière, `20261021000004_revoke_anon_writes.sql`, retire à `anon` et `authenticated` tout droit d'écriture sur le schéma `public`. En production, les versions de migration portent l'horodatage de leur application ; les fichiers du dépôt font foi par leur ordre. Avant tout `supabase db push`, aligner l'historique avec `supabase migration repair --status applied <version>` pour chaque version du dépôt (noms de `supabase/migrations/`) enregistrée en production sous un autre horodatage.

Site (`web/`) :

```sh
cd web && npm install && npm test && npm run build
```

`import:static` et les scripts d'export demandent les variables de `.env.local`, par exemple `npx tsx --env-file=.env.local scripts/import-static.ts`.

## Secrets à définir

Aucun secret ne figure dans le code.

- **Secrets GitHub Actions** (Settings → Secrets and variables → Actions) : `SUPABASE_URL` (URL publique du projet, `https://jsbwehfkvcasuyynfwga.supabase.co`) et `SUPABASE_SERVICE_ROLE_KEY` (clé service role du projet Supabase).
- **Supabase Vault** : `collector_secret`, valeur aléatoire partagée entre la tâche `pg_cron` et l'Edge Function. Déjà créé (`select vault.create_secret(<aléatoire>, 'collector_secret')`), jamais écrit dans le code ni dans les migrations.
- **`.env.local`** (local, ignoré par git) : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, pour les scripts lancés depuis un poste.

## Supervision

- Chaque passage met à jour `collector_state.last_run_at`, même quand le flux n'a pas changé ; `last_error` porte la dernière erreur, ou un avertissement quand le flux contient des TGV mais qu'aucun ne correspond au plan, ou quand le plan du jour est vide.
- `import-static.yml` se termine par `scripts/check-collector.ts`, qui fait échouer le job si le dernier passage date de plus de 10 min ou si `last_error` est renseigné : GitHub envoie alors un courriel à l'auteur.
- GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans commit, et Supabase Free met en pause un projet inactif : il faut surveiller les deux (un commit ou une réactivation manuelle suffit).

## État

- Plan 1, collecte et archive : collecteur en production depuis le 20 octobre 2026 (Supabase, `pg_cron`) ; workflows GitHub écrits, en attente de la création du dépôt GitHub et de ses secrets.
- Plan 2, mesures et API : fonctions SQL et routes `/api/stats` et `/api/live` écrites et vérifiées sur les données réelles ; site **pas encore déployé** (déploiement après accord).
- Plans 3 et 4, à venir : carte, tableau de bord.
