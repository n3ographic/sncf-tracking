# Méthodologie : vérification manuelle (2026-10-21)

Serveur de dev local, base réelle, navigateur intégré.

- La page se lit de haut en bas (sources, périmètre, définitions, indemnités, positions, limites, téléchargements). Seuils de régularité, barèmes INOUI et OUIGO, prix et places viennent de la base et correspondent à `/api/rules`.
- Libellés lisibles : seuils « moins de 1 h 30 / de 1 h 30 à 3 h / plus de 3 h » ; barème INOUI « dès 31 min / 2 h / 3 h 01 » (avec les secondes stockées en base entre parenthèses).
- Base injoignable (second serveur de dev lancé avec `SUPABASE_URL` invalide, cache vidé) : la page répond 200, affiche « Règles indisponibles pour le moment » dans les deux sections concernées et garde tout le reste du texte ; `/api/rules` répond 502.
- Mobile 375 px : pas de défilement horizontal de la page (scrollWidth 375), les tableaux défilent dans leur conteneur ; mode sombre lisible.
- Liens Carte ⇄ Tableau de bord ⇄ Méthodologie présents dans le code (carte : barre ; tableau : en-tête ; méthodologie : en-tête).

## Choix et retouches

- Page rendue à chaque requête (`dynamic = 'force-dynamic'`) : en rendu statique, un build sans accès à la base aurait figé « règles indisponibles ». La base n'est lue qu'une fois par heure par le cache de données (`['rules', 'v1']`), partagé entre la page et `/api/rules`.
- `unwrap` et `Result` déplacés de `handlers.ts` vers `lib/db.ts` pour éviter un import circulaire entre `handlers.ts` et `rules.ts`.
- Constat en passant : le cache de données de Next en dev est partagé entre serveurs via `.next/cache/fetch-cache` (un test d'échec sur un second serveur a d'abord été servi par le cache du premier).

## Limites

- Les téléchargements du journal `events` renvoient aux Releases GitHub, qui n'existent pas encore (premier export début novembre) : la page le dit.
- Non testé avec un lecteur d'écran réel.
