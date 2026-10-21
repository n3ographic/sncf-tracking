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
- Indemnité par voyageur, en pourcentage du billet, plus une valeur en euros sur un prix de référence sourcé. Barèmes **confirmés le 2026-10-21** sur les pages officielles (lectures retenues ci-dessous, section « Définitions retenues »).
- Coût total : estimation, avec ses hypothèses publiées.
- Suppressions : comptées, sans montant tant que la règle n'est pas vérifiée.

## Site
- Next.js sur Vercel. Le temps réel passe par une route en cache 60 s. Pas de Supabase Realtime.
- Carte MapLibre GL, fond libre (OpenFreeMap ou Protomaps). Positions estimées dans le navigateur, le long des voies, à partir des horaires corrigés par le temps réel. Elles sont marquées « estimée » et signalées quand la donnée est périmée.
- Clic sur un train : marque, numéro, origine et destination, prochain arrêt, retard, statut, alerte ou cause, et indemnité théorique.
- Contenu du lancement : la carte, un tableau de bord par axe et par marque (régularité officielle et mesure brute, suppressions, causes), un compteur cumulé des indemnités théoriques, et une page méthodologie avec téléchargements.
- Lecture seule : pas de comptes, pas de notifications, pas de données personnelles.
- Code dans un dépôt GitHub public.

## Définitions retenues (plan 2, 2026-10-21)
Les retards du flux sont des minutes entières, jamais négatifs (vérifié sur 1 804 valeurs). Les règles vivent en base (tables `compensation_scale`, `regularity_rule`, `reference_prices`), publiques et sourcées, pas dans le code.
- **Régularité officielle** (data.gouv.fr « Régularité mensuelle TGV par liaisons », SNCF, ODbL, https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons) : un train est à l'heure si son retard au terminus est **strictement inférieur** à 5 min (durée prévue < 1 h 30), 10 min (de 1 h 30 à 3 h inclus) ou 15 min (plus de 3 h). Taux = trains à l'heure / trains ayant circulé (suppressions exclues du dénominateur, comme l'officiel).
- **Mesure brute** : suppressions comptées comme des échecs ; distribution du retard par tranche (0, 1-4, 5-14, 15-29, 30-59, 60-119, 120-179, 180+ min) au terminus et à chaque arrêt, arrêts supprimés à part. Les tranches s'alignent sur les seuils d'indemnisation.
- **Barème INOUI** (page SNCF Voyageurs « TGV INOUI - INTERCITÉS », mise à jour le 2026-06-17, https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/) : plus de 30 min → 25 %, de 2 h à 3 h → 50 %, au-delà de 3 h → 75 % du prix du billet. Lecture : retard en minutes entières, « plus de » exclusif, « entre » inclusif au départ de la tranche ; en secondes : 25 % dès 1 860, 50 % dès 7 200, 75 % dès 10 860.
- **Barème OUIGO** (page SNCF Voyageurs « OUIGO », mise à jour le 2026-09-04, https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/ouigo/) : de 1 h à 1 h 59 → 25 %, 2 h et plus → 50 % ; en secondes : 25 % dès 3 600, 50 % dès 7 200. Pas de garantie en dessous d'1 h.
- **Suppressions** : comptées, sans montant (aucune règle officielle de montant trouvée).
- **Prix de référence** : prix moyen par marque, base **HT** (FNAUT d'après les données de l'ART, https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf, 2023 : INOUI 46,60 €, OUIGO 34,20 €), sous-estimation d'environ la TVA ; pas de prix par axe. **Capacité** : une rame (INOUI Duplex 556 places, OUIGO 634 places), plancher car les rames couplées ne sont pas connues. **Taux d'occupation** : aucune donnée publiée ; paramètre explicite, 0,75 par défaut, affiché comme hypothèse non sourcée.
- **Coût total estimé** = somme sur les trains ayant circulé de (pourcentage / 100 × prix de référence × capacité × occupation). Toujours accompagné de ses hypothèses.
- **Train terminé** : annulé, ou arrivée prévue + retard au terminus (0 s au minimum) + 30 min dépassée. Seuls les trains terminés entrent dans les statistiques, pour ne pas mélanger des retards encore prévisionnels.
- **Périmètre statistique** : par jour de service, plafonné à 31 jours par requête (le rôle `anon` de Supabase a un délai d'exécution de 3 s).
- **Limite connue des données temps réel** (vérifiée en base le 2026-10-21) : les retards du flux GTFS-RT vont par pas de 5 minutes (356 retards au terminus et 1 944 retards d'arrêt, tous multiples de 5 min, aucun entre 1 et 4 min). Notre « à l'heure » (retard < 5 min) équivaut donc à un retard publié de 0, et le seuil INOUI (plus de 30 min) n'est franchi qu'à 35 min publiées ; le sens de l'arrondi est inconnu. La régularité calculée est une approximation de la régularité officielle (à la minute) : à calibrer sur les chiffres officiels mensuels (plan 4) et à publier sur la page méthodologie avant toute comparaison.

## Découpage en plans
1. Collecte et archive : flux, schéma, import statique, collecteur, export et purge. **Priorité : chaque jour sans collecte est perdu.**
2. Mesures et API : régularité, indemnités, route Vercel en cache.
3. Carte temps réel.
4. Tableau de bord, compteur et méthodologie.
