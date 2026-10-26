# Panneaux de l'écran principal : occuper le vide des colonnes

Date : 2026-10-26. Statut : validé en conversation, à planifier.

## But

Sur ordinateur, le bas de la colonne gauche (sous « Suppressions ») et le bas de la colonne droite (sous « Régularité ») sont vides. On y ajoute trois panneaux denses, dans le style terminal existant, **sans nouvelle API, sans migration, sans nouvelle clé de cache**.

Hors périmètre (second temps) : fourchette en graphique, courbes par jour (`daily_stats`, nouvel endpoint), liaisons les plus en retard (nouvelle requête), causes de retard.

## Contrainte de données

`/api/live` (fonction SQL `live_trains()`) écarte les trains terminés (`circulation_finished`). Une liste « dernières arrivées » est donc impossible sans backend ; elle est remplacée par « Prochaines arrivées ».

## Panneaux

### 1. Retards maintenant (colonne gauche, après « Suppressions »)

- Source : trains de `/api/live`, hors supprimés.
- Une ligne par tranche de `TERMINUS_BUCKETS` (`0`, `1-4`, `5-14`, `15-29`, `30-59`, `60-119`, `120-179`, `180+`), en minutes entières de `delay_s` arrondi vers le bas ; `delay_s` absent compte comme 0.
- Chaque ligne : libellé de tranche, barre en caractères proportionnelle au maximum des tranches (`charBar` existant), nombre de trains. Couleurs : celles de la légende du tableau Marque × Axe.
- Les tranches à 0 sont affichées (forme stable du panneau).
- Échec du live sans trains connus : `INDISPONIBLE`. Aucun train en route : `AUCUN TRAIN EN ROUTE`.

### 2. Prochaines arrivées (colonne gauche, après « Retards maintenant »)

- Source : trains de `/api/live`, hors supprimés.
- Heure estimée = `arr_planned` + `delay_s` (0 si absent). Tri par heure estimée croissante, puis numéro de train ; on garde les 8 premiers.
- Chaque ligne : heure estimée `HH:MM` (Europe/Paris), `IN`/`OG` + numéro, destination tronquée, retard `+N′` coloré par `delayTone` (rien si 0).
- Ligne cliquable : même `onFocus(trip_id)` que « Top retards » (centre la carte et ouvre la fenêtre du train).
- États vides : identiques au panneau 1.

### 3. INOUI / OUIGO (colonne droite, après « Régularité »)

- Source : `stats.groups` de la période choisie (7J / 14J / 31J / mois) ; suit le sélecteur et prend `term-stale` pendant le chargement, comme les autres panneaux de période.
- Par marque : trains (`circulated`), régularité (`on_time_official / circulated`, `—` si 0), indemnités (`estimated_cost_eur_ht`, en € HT arrondis).
- Deux barres empilées de 20 caractères : part de chaque marque dans les trains, puis dans les indemnités. Couleur par marque (deux tons ambre distincts, déjà dans la palette).
- Échantillon de moins de 30 trains pour une marque : ligne estompée (`term-small`), comme ailleurs.
- Échec des stats : `INDISPONIBLE`.

## Code

- `web/lib/terminal-model.ts` : trois fonctions pures, testées d'abord (TDD) dans les tests web existants :
  - `liveBuckets(trains)` → `{ bucket, n }[]` dans l'ordre de `TERMINUS_BUCKETS` ;
  - `nextArrivals(trains, n)` → `LiveItem & { eta: string }` triés ;
  - `brandSplit(groups)` → `{ brand, circulated, on_time, pct, cost, small }[]` (INOUI puis OUIGO, marques absentes omises).
- `web/app/terminal/left-panel.tsx` : panneaux 1 et 2.
- `web/app/terminal/right-panel.tsx` : panneau 3.
- `web/app/terminal/terminal.css` : styles des nouvelles listes ; sur mobile, les nouveaux panneaux viennent après les panneaux existants.

## Vérification

- `cd web && npx vitest run` et `npx tsc --noEmit`.
- Écran local (`preview_start web`) à 1600×900 : plus de vide en bas des colonnes, pas de défilement de page ; textes lus avec `javascript_tool`.
- Largeur mobile : les panneaux s'empilent sans défilement horizontal.
