# Statistiques du tableau de bord sur l'écran terminal (design)

## Objectif

Rendre toutes les statistiques de `/tableau` visibles depuis l'écran d'accueil `/`, dans l'esprit d'un terminal de trading : un seul écran, tout visible sans changer de page. Disposition B des maquettes du 2026-10-22 (« grille de trading »), choisie par l'auteur. La page `/tableau` disparaît.

Hors périmètre : nouvelles données ou API, causes de retard, export CSV, vrais raccourcis clavier (F1/F2 restent des étiquettes de liens).

## Écran principal `/` (≥ 900 px de large)

Un seul écran, sans défilement de la page.

```
┌ barre d'état : OBS·TGV · LIVE · [7J][14J][31J][MOIS ▾] · COLLECTE · COUV ┐
├ bandeau des retards ──────────────────────────────────────────────────────┤
│ GAUCHE 230 px │ CARTE (≈ 62 % de la hauteur)        │ DROITE 270 px       │
│ Top retards   │                                     │ Période : 4 KPI     │
│ Suppressions  ├─────────────────────────────────────┤ Indemn. cumul       │
│               │ MARQUE × AXE (≈ 38 %, défile seul)  │ Régularité par axe  │
├ barre du bas : F1 CARTE · F2 MÉTHODO · non affilié ───────────────────────┤
```

- **Sélecteur de période** (barre d'état) : boutons 7J, 14J, 31J et un menu des mois (`monthOptions`, depuis 2026-10). Valeur par défaut : 7J. Il pilote tous les panneaux de statistiques ; il ne touche ni la carte, ni le bandeau, ni le cumul.
- **Colonne gauche** : « TOP RETARDS » inchangé ; « SUPPRESSIONS » : trains annulés en circulation (inchangé) et taux de suppression de la période choisie (« TAUX 7J », « TAUX 14J », « TAUX 31J », « TAUX OCT. 2026 »).
- **Centre haut** : la carte existante, moins haute (environ 62 % de la hauteur disponible), filtres et compteur inchangés.
- **Centre bas, panneau « MARQUE × AXE »** : le tableau de `/tableau`, mêmes 7 colonnes (marque, axe, trains ayant circulé, régularité, suppressions, retard au terminus, indemnités estimées), même tri (`sortGroups`). En-tête fixe, contenu qui défile dans le panneau. Retard au terminus en barre de caractères (une couleur par tranche, mêmes tranches `TERMINUS_BUCKETS`), avec l'`aria-label` actuel. Ligne de groupe estompée et « n<30 » sous 30 trains ayant circulé. Sous le tableau, une ligne estompée : légende des tranches, « période du … au … », avertissement de méthode (régularité approchée, pas de 5 min, collecte depuis le 20/10) et prix de référence.
- **Colonne droite** :
  - « PÉRIODE » (nouveau, en tête) : trains ayant circulé, régularité officielle approchée, taux de suppression, indemnités théoriques HT ; estompés si moins de 30 trains ayant circulé.
  - « INDEMN. CUMUL » : inchangé (total depuis le 20/10, indépendant de la période).
  - « RÉGULARITÉ » par axe : comme aujourd'hui, mais sur la période choisie (titre « RÉGULARITÉ 7J », « RÉGULARITÉ OCT. 2026 », etc.).
- **Barre du bas** : « F1 CARTE · F2 MÉTHODO », « POSITIONS ESTIMÉES · NON AFFILIÉ SNCF/OUIGO ».

## Mobile (< 900 px)

Empilement : barre d'état (sélecteur de période sur sa propre ligne si besoin), bandeau, carte, panneau « PÉRIODE », tableau marque × axe (défilement horizontal dans son panneau), puis le reste des colonnes. Aucun défilement horizontal de la page.

## Suppression de `/tableau`

- `web/app/tableau/page.tsx` devient une redirection permanente vers `/` (`permanentRedirect`).
- Supprimés : `tableau-view.tsx`, `cumul-banner.tsx`, `tableau.css` et son import dans `web/app/layout.tsx`. Les styles utiles (barre de tranches) passent dans `terminal.css`.
- README : la section `/tableau` décrit désormais l'écran d'accueil.

## Données

- `TerminalView` reste le seul point de chargement. Nouvel état `period` (défaut `7d`). À chaque changement : `fetch('/api/stats?period=…')` ou `?month=…`, avec un compteur de séquence (comme `/tableau`) pour ignorer une réponse devenue obsolète.
- `/api/live` et `/api/cumul` inchangés. Aucun changement d'API, de clé de cache ou de base. `/api/stats` est déjà en cache 15 min par couple de dates.

## États et erreurs

- Chargement d'une nouvelle période : les panneaux de statistiques gardent les anciennes valeurs, estompées, jusqu'à la réponse.
- Échec de `/api/stats` : « INDISPONIBLE » dans chaque panneau de statistiques ; le panneau marque × axe propose « RÉESSAYER ». Carte, bandeau et cumul ne sont pas touchés.
- Aucun groupe sur la période : « AUCUN TRAIN SUR CETTE PÉRIODE ».

## Accessibilité

- Sélecteur : groupe nommé « Période », boutons avec `aria-pressed`, menu des mois en `<select>` étiqueté.
- Tableau : `caption`, `scope` sur les en-têtes, barre de retard avec `role="img"` et `aria-label`.
- Panneau qui défile : région nommée, atteignable au clavier (`tabIndex={0}`).

## Modèle et tests

- Nouvelles fonctions pures dans `web/lib/terminal-model.ts`, testées d'abord (TDD) dans `web/tests/terminal-model.test.ts` :
  - `periodQuery(p)` : `7d` → `period=7d`, `2026-10` → `month=2026-10` ;
  - `periodLabel(p)` : `7d` → `7J`, `2026-10` → `OCT. 2026` ;
  - `bucketBar(buckets, width)` : segments de caractères par tranche, largeurs proportionnelles, somme égale à `width`, vide si aucun train.
- `dashboard-model` est réutilisé tel quel.
- Vérification dans le navigateur, en local puis en production : écran sans défilement à 1440×900, changement de période (valeurs et titres), mobile à 375 px, panne de la base (`SUPABASE_URL=http://127.0.0.1:9`), redirection `/tableau` → `/`.
