# Design « terminal » de l'observatoire (design)

## Objectif

Refondre l'interface en écran unique façon terminal boursier (Bloomberg) : maximaliste, technique, rétro, vif. La carte reste au centre, entourée de panneaux de données. Piste A des maquettes du 2026-10-22 (noir et ambre), choisie par l'auteur.

Hors périmètre : nouvelles données, journal d'événements (la table `events` n'est pas publique ; à traiter à part), raccourcis clavier, mode clair (supprimé).

## Écran principal `/` (≥ 900 px de large)

- **Barre d'état** (haut) : « OBS·TGV » en bloc ambre inversé ; heure courante (heure de Paris, à la seconde) ; état de la collecte : « COLLECTE OK » en vert si le `last_seen_at` le plus récent de `/api/live` a moins de 10 minutes, sinon « COLLECTE EN RETARD » en rouge ; couverture du compteur cumulé (`/api/cumul`, `coverage_pct`).
- **Bandeau défilant** : les 15 trains en circulation les plus en retard (`delay_s` décroissant, annulés exclus) : flèche, marque, numéro, retard en minutes, origine → destination ; couleur par classe de retard. Pause au survol et au focus ; statique (liste tronquée) si `prefers-reduced-motion: reduce`.
- **Colonne gauche** : « TOP RETARDS » (10 premiers, numéro, retard ; un clic centre la carte sur le train et ouvre sa fenêtre) ; « SUPPRESSIONS » (trains annulés en circulation maintenant ; taux sur 7 jours lu dans `/api/stats?period=7d`).
- **Centre** : la carte MapLibre existante, fond OpenFreeMap `dark` (`https://tiles.openfreemap.org/styles/dark`), voies en ambre foncé, points colorés par classe de retard (mêmes classes et seuils qu'aujourd'hui), fenêtre au clic au style terminal ; filtres marque et axe et case « Afficher les voies » dans une ligne au-dessus de la carte ; compteur « N TRAINS · N EN ROUTE · N EN RETARD » en bas de la carte.
- **Colonne droite** : « INDEMN. CUMUL » (montant HT, trains observés, couverture, mention « observé seulement ») ; « RÉGULARITÉ 7J » par axe tous trains confondus, en barres de caractères (█ et ▌) avec la valeur ; un axe dont l'effectif est inférieur à 30 trains est estompé et marqué « n<30 ».
- **Barre du bas** : liens « F1 CARTE · F2 TABLEAU · F3 MÉTHODO » (étiquettes décoratives, de vrais liens), « POSITIONS ESTIMÉES · NON AFFILIÉ SNCF/OUIGO ».

## Style

- Thème sombre unique ; mode clair supprimé.
- Jetons de couleur (variables CSS) : fond `#0a0a0a`, panneau `#0f0f0f`, texte ambre `#ffb000`, ambre atténué `#a07000` (texte secondaire, contraste ≥ 4,5:1 sur le fond), filets `#4a3200` ; retards : à l'heure `#3ad13a`, retard `#ffd24d` (5-29 min), fort retard `#ff8c00`, très fort retard `#ff4d4d` (≥ 60 min), annulé `#8a8a8a`. Les classes de la carte gardent leurs seuils (`ontime` < 5 min, `late` ≥ 5 min, `severe` ≥ 30 min) ; la couleur rouge s'ajoute pour 60 min et plus.
- Police IBM Plex Mono (`next/font/google`, embarquée au build), chiffres alignés ; étiquettes de panneau en majuscules sur bloc ambre.
- Panneaux : filet de 1 px, pas d'ombre ni de dégradé ni de lueur.
- `/tableau` et `/methodologie` : même barre d'état et barre du bas, contenus restylés dans les mêmes jetons (tableaux, barres, avertissements), structure inchangée.

## Mobile (< 900 px)

Empilement : barre d'état (sur deux lignes si besoin), bandeau, carte (60 % de la hauteur de l'écran), puis colonne gauche et colonne droite ; filtres dans un volet repliable « FILTRES ». Aucun défilement horizontal de la page.

## Données

Aucune nouvelle source : `/api/live` (bandeau, top retards, suppressions en cours, fraîcheur, compteur de la carte), `/api/cumul` (indemnités, couverture), `/api/stats?period=7d` (régularité par axe, taux de suppression). Aucune modification de base, d'API ni de cache.

## Unités

- `web/lib/terminal-model.ts` (pur, testé) : `topDelays(trains, n)`, `tickerItems(trains, n)`, `delayTone(delay_s, cancelled)` (`ontime | late | strong | severe | cancelled`), `collectStatus(trains, now)` (`ok | late`, plus l'âge en minutes), `axisRegularity(stats)` (agrège les groupes par axe toutes marques : `circulated`, `on_time_official`, pourcentage, `small`), `charBar(pct, width)` (barre de caractères pleine et demi).
- Composants client sous `web/app/terminal/` : barre d'état, bandeau, panneaux gauche et droite, barre du bas ; la carte actuelle (`carte-view.tsx`) devient le panneau central et expose le centrage sur un train.
- Styles : `web/app/terminal/terminal.css` (jetons et grille), reprise de `tableau.css`, `methodologie.css`, `carte.css`.

## Erreurs

Chaque panneau gère son propre échec (« — » ou « INDISPONIBLE » en ambre atténué) sans bloquer les autres ni la carte ; l'état de la collecte passe en « INCONNU » si `/api/live` échoue.

## Accessibilité

Retards toujours écrits en chiffres ; focus visible (contour ambre) ; bandeau pausable et statique sous `prefers-reduced-motion` ; contrastes vérifiés (ambre atténué ≥ 4,5:1) ; titres de panneaux en vrais titres.

## Tests

Vitest sur `terminal-model.ts` (tri et exclusion des annulés, classes de retard aux seuils 5, 30 et 60 min, fraîcheur à 10 minutes, agrégation par axe et seuil de 30, barres de caractères à 0, 50 et 100 %). Vérification dans le navigateur avec les vraies données : bureau 1440 px, 1024 px, mobile 375 px ; échec simulé de chaque API ; clic dans le top des retards.
