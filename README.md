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

## Développement

Node 24 requis.

```sh
npm install
npm test               # tests unitaires (vitest)
npm run inspect        # sondage des flux GTFS-RT et du GTFS statique
npm run import:static  # import du GTFS statique, lit SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
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

- Plan 1, collecte et archive : collecteur en service depuis le 20 octobre 2026 (Supabase, `pg_cron`) ; workflows GitHub écrits, en attente de la création du dépôt GitHub et de ses secrets.
- Plans 2 à 4, à venir : mesures de régularité, carte, tableau de bord.
