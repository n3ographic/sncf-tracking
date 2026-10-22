# Design terminal : vérification (2026-10-22)

Serveur de dev local, données réelles, navigateur intégré.

- **Bureau 1 440 px** : trois colonnes ; barre d'état (heure de Paris, « COLLECTE OK · 0 MIN », couverture 59,3 %) ; bandeau défilant des retards ; top des retards (12176, 12184, 5500… à +40′) ; carte sombre OpenFreeMap `dark` avec voies ambre foncé et points par ton ; à droite 711 272 € HT d'indemnités sur 684 trains observés et la régularité 7 j par axe en barres de caractères (ATL 82,3, EST 74,4, INTER 60,0, NORD 61,9, S-EST 46,1). 179 trains, 100 en route, 59 en retard.
- **Clic dans le top** : la carte se centre sur l'INOUI 12176 (Nice → Strasbourg) et ouvre la fenêtre au style terminal (« RETARD 40′ · FORT RETARD », indemnité 11,65 €).
- **Panne totale** (second serveur avec base injoignable) : chaque panneau affiche « INDISPONIBLE », collecte « INCONNUE », bandeau rouge sur la carte, voies toujours affichées, aucune erreur ; bandeau défilant « FLUX INDISPONIBLE » (au lieu de « aucun train en retard », corrigé pendant la vérification).
- **`/tableau` et `/methodologie`** : barres d'état et du bas, panneaux, tableaux et titres au thème ; contenu inchangé.
- **Mobile 375 px** : empilement, carte à 60 vh, filtres repliés par défaut, `scrollWidth` = 375 (aucun défilement horizontal).

## Retouches pendant la vérification

- Abréviations d'axes explicites (« S-EST » au lieu de « SUD_ » tronqué).
- Ambre atténué porté de `#a07000` à `#b07c00` : 4,4:1 seulement sur le fond des panneaux, 5,2:1 désormais.
- Attribution de la carte en sombre (elle s'affichait en blanc sur mobile).
- Texte des positions dans la méthodologie et le README mis à jour (il décrivait encore l'ancienne règle « dernier arrêt portant un retard »).

## Limites

- Pas de journal d'événements (table `events` non publique).
- Non testé avec un lecteur d'écran réel ; la pause du bandeau au clavier passe par le focus du bandeau.

## Production (https://sncf-tracking.vercel.app)

`/`, `/tableau`, `/methodologie`, `/api/live`, `/api/cumul`, `/api/stats?period=7d`, `/trace-paires.json`, worker MapLibre : 200 ; police servie depuis le site (woff2) ; écran terminal rendu dans le navigateur (178 trains, 100 en route, 58 en retard, collecte OK, couverture 59,3 %), aucune erreur console.

Défaut mineur restant : dans l'attribution de la carte, le texte « Data from » garde la couleur sombre par défaut de MapLibre (peu lisible) ; les liens sont corrects. Corrigé (commit `b05ba57`, `!important` sur la couleur) : ambre `rgb(176,124,0)` mesuré en production.

## Vérification de jour en production (2026-10-22, ~15 h 40)

176 trains, ~100 en route.

- **LGV** : les trains suivent les tracés sur la LGV Sud-Est (Paris → Bourgogne → Lyon), l'Atlantique (Le Mans, Tours, Bordeaux) et l'Est. Un point hors tracé à l'est de Paris : INOUI 9866 Marseille → Bruxelles, marqué « Donnée périmée » (comportement attendu ; trajet probable par l'interconnexion Est / Marne-la-Vallée, gare sans tracé).
- **Fenêtre au clic** : numéro, origine → terminus, retard, « Position estimée », mention de donnée périmée. Fermeture par × ; Échap ne la ferme pas (comportement par défaut de MapLibre).
- **Filtres** : marque OUIGO → 25 trains ; axe EST → 16 trains, seuls les points de l'axe restent ; case « Voies » masque puis réaffiche les tracés.
- **Fausse alerte « COLLECTE EN RETARD »** : le bandeau passe au rouge (11-12 min) alors que le cron `collect` réussit toutes les 2 min. Cause : deux caches empilés, Data Cache Next (300 s) puis CDN Vercel (`s-maxage=300, stale-while-revalidate=60`). Mesure à 13:39 UTC : réponse `HIT`, `age: 259`, `generated_at` 13:30:00, dernier train vu 13:28. Pire cas ~14 min, au-delà du seuil `FRESH_S = 600` s et du compromis de ~8 min accepté. Non corrigé.
