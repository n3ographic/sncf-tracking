# Plan 4a : tableau de bord (design)

Premier des trois sous-plans du plan 4 : 4a tableau de bord, 4c méthodologie et téléchargements, 4b compteur cumulé (ordre retenu : 4a, 4c, 4b).

## Objectif et périmètre

Page `/tableau` : régularité et suppressions par marque et par axe sur une période choisie, avec l'effectif de chaque chiffre. Elle lit `/api/stats` telle qu'elle est ; aucun changement d'API, de base ni de cache.

Hors périmètre : les causes (la spec générale les mentionne, mais `/api/stats` n'en renvoie pas ; il faudra une agrégation des causes en base, point reporté), le compteur cumulé (4b), la page méthodologie (4c), la comparaison avec la régularité officielle mensuelle.

## Principe sur les petits échantillons

Tout est affiché, avec l'effectif `n` (= `circulated`). Un groupe dont `circulated` est inférieur à `SAMPLE_MIN = 30` est estompé et porte la mention « échantillon trop petit ». Rien n'est masqué. Un bandeau rappelle que la collecte a commencé le 20 octobre 2026 et que la régularité est une approximation de la régularité officielle (les retards du flux vont par pas de 5 minutes : « à l'heure » équivaut à un retard publié de 0).

## Contenu

- Sélecteur de période : `7d` (défaut), `14d`, `31d`, puis un mois par entrée de `2026-10` au mois courant (heure de Paris), du plus récent au plus ancien. Choix transmis à `/api/stats` (`?period=` ou `?month=`).
- Quatre chiffres clés, tous groupes confondus (`totals`) : trains ayant circulé (`circulated`), régularité officielle approchée (`official_regularity_pct`), taux de suppression (`cancelled / (cancelled + circulated)`), coût estimé des indemnités en euros HT (`estimated_cost_eur_ht`, occupation de référence lue dans `assumptions.occupancy`). Le même seuil `SAMPLE_MIN` estompe les chiffres clés.
- Tableau par marque et par axe (`groups`) : effectif, régularité, taux de suppression, répartition des retards au terminus par tranche (`terminus_buckets` : 0, 1-4, 5-14, 15-29, 30-59, 60-119, 120-179, 180+ min) en barre empilée, coût estimé. Tri : marque puis axe.
- Période affichée sous le sélecteur (`from` – `to` de la réponse) ; les hypothèses (prix de référence HT, occupation 0,75 non sourcée) en note de bas de page, lues dans `assumptions`.
- Lien « Carte » sur le tableau de bord et lien « Tableau de bord » sur la carte, en haut de page.

## Unités

- `web/lib/dashboard-model.ts` (pur, testé) :
  - `SAMPLE_MIN = 30`
  - `isSmallSample(t: { circulated: number }): boolean` — `circulated < SAMPLE_MIN`
  - `suppressionPct(t: { cancelled: number; circulated: number }): number | null` — `null` si `cancelled + circulated = 0`, arrondi à 0,1
  - `bucketShares(buckets: Record<string, number>): { bucket: string; n: number; pct: number }[]` — dans l'ordre des tranches, `pct` à 0,1, tout à 0 si le total est nul
  - `monthOptions(now: Date, first = '2026-10'): string[]` — mois `AAAA-MM` du plus récent au plus ancien, calculés à l'heure de Paris, traverse les changements d'année
  - `sortGroups(groups: Group[]): Group[]` — marque puis axe
- `web/app/tableau/page.tsx` : page serveur minimale (titre, rend la vue).
- `web/app/tableau/tableau-view.tsx` : composant client (période, chargement, erreur avec « Réessayer », tableau, bandeau).
- Types `Group`, `Totals`, `StatsPayload` réutilisés depuis `web/lib/stats.ts`.
- Styles dans `web/app/tableau/tableau.css` (jetons de couleur, mode sombre, mobile 375 px).

## Erreurs et états

- Chargement : « Chargement… » ; réponse en erreur ou réseau coupé : message et bouton « Réessayer », jamais d'écran vide.
- Période sans aucun train : chiffres clés à « — », tableau vide avec un message.
- `official_regularity_pct` nul : « — ».

## Accessibilité

Vrai `<table>` avec `<caption>` et en-têtes de colonnes ; chaque barre empilée a son équivalent en texte (valeurs en pourcentage dans le tableau ou une liste visible au survol et lisible par les lecteurs d'écran) ; pas de couleur seule pour l'information ; contraste suffisant en clair et en sombre.

## Tests

Vitest sur `dashboard-model.ts` : seuil exact (29 petit, 30 non), division par zéro, tranches vides, mois à cheval sur décembre/janvier, tri. Vérification de la page dans le navigateur intégré (bureau et mobile), y compris la panne simulée de l'API.
