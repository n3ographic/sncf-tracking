# Statistiques du tableau sur l'écran terminal — vérification (2026-10-22)

Spec : `docs/superpowers/specs/2026-10-22-home-stats-terminal-design.md`. Plan : `docs/superpowers/plans/2026-10-22-home-stats-terminal.md`.

## Vérifié en local (serveur de dev, données réelles)

- **1440×900** : aucun défilement de la page (`scrollHeight` = 900) ; carte ≈ 400 px, panneau « MARQUE × AXE » dessous avec ses 9 lignes (INOUI et OUIGO × 5 axes, moins OUIGO NORD absent).
- **1280×720** : aucun défilement de la page (`scrollHeight` = 720) ; carte ≈ 290 px, 8 lignes visibles, le tableau défile dans son panneau.
- **Mobile 375 px** : ordre carte, PÉRIODE, MARQUE × AXE, puis top retards, suppressions, cumul, régularité ; aucun défilement horizontal (`scrollWidth` = 375).
- **Période** : 7J → 14J → mois ; titres « PÉRIODE 14J », « RÉGULARITÉ OCT. 2026 », « TAUX OCT. 2026 » ; valeurs mises à jour (7J : 660 trains, 65,8 % ; OCT. 2026 : 947 trains, 69,8 %). 7J et 14J donnent les mêmes chiffres : la collecte n'a commencé que le 20/10.
- **Changements rapides** : 31J → 7J → OCT. en moins d'une seconde ; l'affichage final est celui d'octobre, aucun panneau ne reste estompé.
- **Base injoignable** (`SUPABASE_URL=http://127.0.0.1:9`, port 3001) : tous les panneaux « INDISPONIBLE », bandeau de carte « DONNÉES INDISPONIBLES », bouton « RÉESSAYER » qui relance `/api/stats`, page sans défilement.
- **`/tableau`** : 308 vers `/`.
- Tests : 112/112 (3 nouveaux : `periodQuery`, `periodLabel`, `bucketBar`) ; typage ; build de production réussi.

## Limites

- Le cas « aucun groupe sur la période » n'est pas atteignable avec les données actuelles (premier mois = octobre 2026) : contrôlé à la relecture du code.
- La panne testée coupe toutes les sources ensemble ; une panne de `/api/stats` seule n'a pas été provoquée (chaque source a son propre état d'échec).
- Dans la barre de tranches, une tranche qui représente moins d'une case sur 12 disparaît ; elle reste dans l'`aria-label` et l'infobulle.
