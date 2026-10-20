# Observatoire indépendant du trafic TGV — spec

Issue de la session de grill du 2026-10-20. Toutes les décisions ci-dessous ont été validées par l'auteur.

## Projet
- Site public, en français, juridiquement indépendant : aucun partenariat, logo, couleur ou nom évoquant SNCF ou OUIGO. Mention « non affilié » visible.
- Démarche data-journalisme et design critique : ponctualité, défaillances, coût théorique des retards.
- Périmètre : TGV INOUI et OUIGO. Le modèle porte un champ `brand` pour s'étendre à d'autres trains plus tard.
- Axes : rattachement par la gare parisienne desservie. Paris Nord → `NORD`, Paris Gare de Lyon ou Bercy → `SUD_EST`, Paris Montparnasse → `ATLANTIQUE`, Paris Est → `EST`. Tout le reste → `INTERSECTEURS`.
- Coût nul : offres gratuites uniquement. Lancement sur `*.vercel.app`, nom choisi plus tard.
- Langue : français uniquement.

## Données
- Source principale : GTFS-RT de transport.data.gouv.fr, sans clé, rafraîchi toutes les 2 min.
  - Trip Updates : `https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates`
  - Service Alerts : `https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts`
- Plan B : si OUIGO est absent du flux, compléter OUIGO avec l'API Navitia, dans son quota gratuit.
- Horaires théoriques : GTFS statique `https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip`, importé chaque jour par GitHub Actions et filtré sur INOUI et OUIGO.
- Tracés : fichier de formes des lignes du réseau ferré national de SNCF Réseau (ODbL), converti une fois en GeoJSON simplifié. OpenStreetMap en secours.

## Collecte et archive
- Supabase : nouveau projet `sncf-tracking` en région `eu-west-3`. pg_cron appelle une Edge Function toutes les 2 min.
- On ne stocke pas le brut, seulement les changements, sur deux niveaux :
  - `events` : journal immuable des changements, gardé 30 jours glissants ;
  - `circulations` : une ligne par train et par jour, gardée indéfiniment.
- Chaque mois, le journal est exporté en CSV gzip dans une Release GitHub du dépôt public. Il n'est purgé qu'une fois l'export confirmé. Le jeu sera référencé sur data.gouv.fr plus tard.
- Données publiées sous ODbL, avec crédit à SNCF Open Data et transport.data.gouv.fr.

## Mesures
- Régularité officielle SNCF : retard au terminus de moins de 5 min (trajet de moins de 1 h 30), 10 min (de 1 h 30 à 3 h) ou 15 min (plus de 3 h).
- Mesure brute : distribution du retard à la minute, à chaque arrêt. Une suppression compte comme un échec.
- Indemnité par voyageur, en pourcentage du billet, plus une valeur en euros sur un prix de référence sourcé. Le barème est **provisoire** et doit être confirmé sur les pages officielles avant toute publication de montants :
  - INOUI : 25 % de 30 à 119 min, 50 % de 120 à 179 min, 75 % à partir de 180 min.
  - OUIGO : 25 % de 60 à 119 min, 50 % à partir de 120 min.
- Coût total : estimation, avec ses hypothèses publiées.
- Suppressions : comptées, sans montant tant que la règle n'est pas vérifiée.

## Site
- Next.js sur Vercel. Le temps réel passe par une route en cache 60 s. Pas de Supabase Realtime.
- Carte MapLibre GL, fond libre (OpenFreeMap ou Protomaps). Positions estimées dans le navigateur, le long des voies, à partir des horaires corrigés par le temps réel. Elles sont marquées « estimée » et signalées quand la donnée est périmée.
- Clic sur un train : marque, numéro, origine et destination, prochain arrêt, retard, statut, alerte ou cause, et indemnité théorique.
- Contenu du lancement : la carte, un tableau de bord par axe et par marque (régularité officielle et mesure brute, suppressions, causes), un compteur cumulé des indemnités théoriques, et une page méthodologie avec téléchargements.
- Lecture seule : pas de comptes, pas de notifications, pas de données personnelles.
- Code dans un dépôt GitHub public.

## Découpage en plans
1. Collecte et archive : flux, schéma, import statique, collecteur, export et purge. **Priorité : chaque jour sans collecte est perdu.**
2. Mesures et API : régularité, indemnités, route Vercel en cache.
3. Carte temps réel.
4. Tableau de bord, compteur et méthodologie.
