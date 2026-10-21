# Plan 4c : méthodologie et règles téléchargeables (design)

Deuxième des trois sous-plans du plan 4 (4a tableau de bord livré, 4c méthodologie, 4b compteur cumulé).

## Objectif et périmètre

Page `/methodologie` qui explique ce que mesure l'observatoire, avec les règles lues dans la base (pas copiées dans le code), et route `GET /api/rules` pour les télécharger en JSON.

Hors périmètre : export mensuel des circulations (plan à part : il touche le pipeline de production et la purge), comparaison avec la régularité officielle mensuelle (quand un mois complet sera disponible), causes de retard.

## Données

- Tables publiques lues avec la clé `anon` : `compensation_scale` (`brand`, `from_s`, `pct`, `source_url`, `source_as_of`), `regularity_rule` (`duration_from_s`, `max_delay_exclusive_s`, `source_url`), `reference_prices` (`brand`, `price_eur_ht`, `seats`, `price_source`, `seats_source`, `as_of`).
- Lecture par une seule fonction, partagée par la page et la route, derrière le cache de données de Next (clé fixe `['rules', 'v1']`, 3 600 s) : une seule requête vers la base par heure, quel que soit le trafic.

## Route `GET /api/rules`

Aucun paramètre (tout paramètre donne `400`, `no-store`, comme les autres routes). Réponse : `{ generated_at, compensation_scale, regularity_rule, reference_prices }`, valeurs `numeric` converties en nombres (Postgres les renvoie en chaînes), tri stable (barème par marque puis seuil, régularité par durée, prix par marque). Cache : `public, s-maxage=3600, stale-while-revalidate=600`. Erreur de lecture : `502`, `no-store`, jamais mise en cache (même garde que `/api/stats`).

## Page `/methodologie`

Composant serveur, rafraîchi toutes les heures. Français, mode sombre, 375 px, titres hiérarchisés, tableaux avec `<caption>`.

1. **Sources et licence** : GTFS temps réel SNCF (transport.data.gouv.fr), GTFS statique SNCF Open Data, fichier de formes des lignes du RFN (SNCF Réseau), régularité mensuelle TGV par liaisons (data.gouv.fr) ; licence ODbL, attribution.
2. **Périmètre** : TGV INOUI et OUIGO TGV ; OUIGO Train Classique exclus (numéros 4000 à 4999).
3. **Définitions** : prévu / observé / jamais observé / retiré tard / annulé / sans terminus / ayant circulé ; régularité officielle (tableau des seuils lu dans `regularity_rule`, retard strictement inférieur au seuil, suppressions exclues du dénominateur) ; mesure brute (suppressions comptées comme des échecs, huit tranches de retard).
4. **Indemnités théoriques** : barèmes lus dans `compensation_scale` (une table par marque, avec la source et sa date), prix de référence HT et places lus dans `reference_prices`, occupation 0,75 signalée comme hypothèse non sourcée, coût = pourcentage × prix × places × occupation.
5. **Positions sur la carte** : estimées, pas mesurées (retard constant, tracé des voies sinon ligne droite) ; donnée périmée après 10 minutes.
6. **Limites connues** : collecte depuis le 20 octobre 2026 ; retards du flux par pas de 5 minutes (« à l'heure » = retard publié de 0, la régularité est une approximation de l'officielle, à calibrer avant toute comparaison) ; trains absents du plan du jour non collectés ; échantillons de moins de 30 trains estompés ; causes de retard pas encore agrégées ; tracés absents pour quelques gares.
7. **Téléchargements** : règles en JSON (`/api/rules`) ; journal mensuel `events-AAAA-MM` dans les Releases GitHub (lien, avec la mention « premier export début novembre 2026 » tant qu'aucune Release `events-*` n'existe) ; dépôt GitHub.

Lien « Méthodologie » sur la carte et sur le tableau de bord ; liens de retour vers les deux.

## Unités

- `web/lib/rules.ts` (pur, testé) : `type Rules`, `shapeRules(raw, now)` (conversion numérique, tri, copie des sources).
- `web/lib/handlers.ts` : `createRulesHandler(deps)` sur le modèle de `createLiveHandler`, avec un `Deps` inchangé.
- `web/app/api/rules/route.ts` : branchement.
- `web/app/methodologie/page.tsx` (+ `methodologie.css`) : lecture via la fonction partagée ; en cas d'échec, message « règles indisponibles » et le texte fixe reste affiché (la page ne plante pas et le build non plus).

## Tests

- `shapeRules` : chaînes numériques converties, tri, valeur non numérique rejetée avec une erreur claire, tables vides acceptées.
- Handler : `400` avec paramètre (`no-store`), `200` et forme exacte, en-tête de cache, clé de cache `['rules', 'v1']` avec 3 600 s, `502` `no-store` quand une table échoue.
- Page : vérification manuelle (bureau, mobile, sombre ; texte lisible si les règles sont indisponibles) ; en production, `curl` de `/api/rules` (200, forme, cache).
