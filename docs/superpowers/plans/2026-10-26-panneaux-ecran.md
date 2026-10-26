# Panneaux de l'écran principal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Occuper le vide des colonnes gauche et droite de l'écran avec trois panneaux : Retards maintenant, Prochaines arrivées, INOUI / OUIGO.

**Architecture:** Trois fonctions pures ajoutées à `web/lib/terminal-model.ts` (testées d'abord), consommées par `left-panel.tsx` et `right-panel.tsx`. Aucune nouvelle API, migration ni clé de cache : les données viennent déjà de `/api/live` (`trains`) et de `/api/stats` (`stats.groups`).

**Tech Stack:** Next.js (React client), TypeScript, Vitest, CSS du terminal (`web/app/terminal/terminal.css`).

**Spec:** `docs/superpowers/specs/2026-10-26-panneaux-ecran-design.md`

## Global Constraints

- Branche `ecran-panneaux` (déjà créée, contient la spec). Pas de push ; fusion en `--ff-only` seulement après accord.
- Aucune nouvelle API, migration SQL ni clé de cache.
- Les tranches sont `TERMINUS_BUCKETS` de `web/lib/dashboard-model.ts` : `0`, `1-4`, `5-14`, `15-29`, `30-59`, `60-119`, `120-179`, `180+`.
- Couleurs des tranches : classes existantes `seg-c s0` à `s7`. Couleurs des retards : `delayTone` et classes `tone-*`.
- Échantillon de moins de 30 trains (`isSmallSample`) : classe `term-small`. Chargement de la période : classe `term-stale`.
- Heures affichées en Europe/Paris. Textes en français avec accents, majuscules comme les autres panneaux.
- Tests : `cd web && npx vitest run` et `cd web && npx tsc --noEmit` doivent passer à chaque tâche.

## Review Focus

- Un train sans `delay_s` ou avec un retard négatif compte dans la tranche `0` (test dans la tâche 1).
- Un train supprimé n'apparaît ni dans les tranches ni dans les arrivées (tâche 1).
- Deux trains à la même heure estimée : ordre stable par numéro de train (tâche 1).
- Une marque absente des groupes ou à 0 train : omise sans diviser par zéro (tâche 1).
- Panneaux avec échec ou liste vide : textes `INDISPONIBLE` / `AUCUN TRAIN EN ROUTE`, jamais un panneau vide (tâches 2 et 3, vérifiés à l'écran en tâche 4 avec la configuration `web-panne`).

---

### Task 1: Fonctions pures du modèle

**Files:**
- Modify: `web/lib/terminal-model.ts`
- Test: `web/tests/terminal-model.test.ts` (utilise déjà le helper `item(over)` et `Group`)

**Interfaces:**
- Consumes: `LiveItem` (`web/lib/map-model.ts`), `Group` (`web/lib/stats.ts`), `TERMINUS_BUCKETS` et `isSmallSample` (`web/lib/dashboard-model.ts`).
- Produces :
  - `liveBuckets(trains: LiveItem[]): { bucket: string; n: number }[]` : 8 entrées dans l'ordre de `TERMINUS_BUCKETS`.
  - `nextArrivals(trains: LiveItem[], n: number): (LiveItem & { eta: string })[]` : `eta` au format `HH:MM`.
  - `brandSplit(groups: Group[]): { brand: string; circulated: number; pct: number | null; cost: number; small: boolean; trains_share: number; cost_share: number }[]` : INOUI puis OUIGO, parts en pourcentage (0 à 100) de la somme des marques présentes.

- [ ] **Step 1: Écrire les tests qui échouent**, dans `web/tests/terminal-model.test.ts` (compléter l'import) :
  - `liveBuckets : tranches des retards en minutes, supprimés écartés, retard absent ou négatif à 0` : trains avec `delay_s` 0, 60, 299, 300, 899, 900, 1800, 3600, 7200, 10800, `undefined`, −120, et un supprimé à 5000 ; attendu `{0:3,'1-4':2,'5-14':2,'15-29':1,'30-59':1,'60-119':1,'120-179':1,'180+':1}` en n par tranche, tableau toujours de 8 entrées dans l'ordre. Un second test : `[]` donne 8 entrées à 0.
  - `nextArrivals : tri par heure estimée, puis numéro, supprimés écartés, coupe à n` : `arr_planned` `2026-10-22T17:00:00Z` avec `delay_s` 3600 (eta `19:00` en heure de Paris, UTC+2 ce jour-là) face à un train prévu `17:30:00Z` sans retard (eta `19:30`) ; deux trains à la même eta `a` et `b` sortent dans l'ordre `a`, `b` ; un supprimé absent ; `nextArrivals(l, 2)` renvoie 2 éléments ; `nextArrivals([], 8)` renvoie `[]`.
  - `brandSplit : régularité, indemnités et parts par marque ; marque absente omise` : groupes `{brand:'INOUI', axis:'EST', circulated:300, on_time_official:210, estimated_cost_eur_ht:6000}`, `{brand:'INOUI', axis:'NORD', circulated:100, on_time_official:70, estimated_cost_eur_ht:2000}`, `{brand:'OUIGO', axis:'EST', circulated:100, on_time_official:80, estimated_cost_eur_ht:2000}` (compléter les autres champs de `Group` avec le helper de groupe existant dans le fichier de test, ou un objet partiel casté) ; attendu INOUI `{circulated:400, pct:70, cost:8000, small:false, trains_share:80, cost_share:80}` et OUIGO `{circulated:100, pct:80, cost:2000, small:false, trains_share:20, cost_share:20}`. Cas : sans groupe OUIGO, la liste n'a que INOUI avec parts 100 ; `[]` donne `[]` ; une marque à `circulated: 0` donne `pct: null`, `small: true`, sans NaN dans les parts.
- [ ] **Step 2: Lancer et voir échouer** : `cd web && npx vitest run tests/terminal-model.test.ts` ; attendu : FAIL, `liveBuckets is not a function` (et les deux autres).
- [ ] **Step 3: Implémenter les trois fonctions** dans `web/lib/terminal-model.ts`, avec les signatures ci-dessus.
  - `liveBuckets` : minutes = `Math.floor(Math.max(delay_s ?? 0, 0) / 60)`, rangées par seuils 0, 1, 5, 15, 30, 60, 120, 180.
  - `nextArrivals` : heure estimée = `Date.parse(arr_planned) + (delay_s ?? 0) * 1000` ; `eta` formaté avec `Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })` ; tri par heure puis `train_number.localeCompare`.
  - `brandSplit` : regroupe par `brand`, `pct` arrondi à 1 décimale (`null` si `circulated` vaut 0), `small` = `isSmallSample({ circulated })`, parts arrondies à l'entier, 0 si le total est nul.
- [ ] **Step 4: Lancer et voir passer** : `cd web && npx vitest run && npx tsc --noEmit` ; attendu : tous les tests passent, pas d'erreur de type.
- [ ] **Step 5: Commit**

```bash
git add web/lib/terminal-model.ts web/tests/terminal-model.test.ts
git commit -m "feat(web): fonctions pures des nouveaux panneaux (tranches live, prochaines arrivées, répartition par marque)"
```

---

### Task 2: Panneaux « Retards maintenant » et « Prochaines arrivées »

**Files:**
- Modify: `web/app/terminal/left-panel.tsx`
- Modify: `web/app/terminal/terminal.css`

**Interfaces:**
- Consumes: `liveBuckets`, `nextArrivals`, `delayTone`, `charBar` (`web/lib/terminal-model.ts`) ; les props existantes de `LeftPanel` (`trains`, `liveFailed`, `onFocus`) ; `TERMINUS_BUCKETS`.
- Produces: deux `<section className="term-panel">` ajoutées à la fin de `LeftPanel`, sans changement de props.

- [ ] **Step 1: Ajouter le panneau « Retards maintenant »** à `left-panel.tsx`, après « Suppressions », sur le modèle de « Top retards » :
  - titre `Retards maintenant` ;
  - même condition d'échec (`liveFailed && trains.length === 0` donne `INDISPONIBLE`) ; liste vide (aucune tranche > 0) donne `AUCUN TRAIN EN ROUTE` ;
  - sinon une liste `ul.live-buckets`, une ligne par tranche : libellé `{bucket}′` (largeur fixe), barre `charBar(n / max * 100, 12)` en `span.seg-c.s{i}` (le `i` est l'indice de la tranche), nombre `n` aligné à droite. Les tranches à 0 sont affichées avec une barre vide.
- [ ] **Step 2: Ajouter le panneau « Prochaines arrivées »** à la suite : titre `Prochaines arrivées`, mêmes états vides, puis `ol.top-list` (classe existante, donc même style et même survol) avec 8 lignes `button` appelant `onFocus(t.trip_id)` : à gauche `{eta} {IN|OG} {train_number}`, au milieu la destination tronquée par CSS (`overflow: hidden; text-overflow: ellipsis`), à droite `+N′` en `tone-{delayTone}` seulement si le retard arrondi est supérieur à 0.
- [ ] **Step 3: CSS** dans `terminal.css` : `.live-buckets` (liste sans puce, ligne en grille `34px 1fr auto`, barre `white-space: pre; letter-spacing: -1px` comme `.reg-bar`) et la mise en page de la ligne d'arrivée (destination qui rétrécit, retard à droite).
- [ ] **Step 4: Vérifier** : `cd web && npx tsc --noEmit && npx vitest run` ; attendu : propre.
- [ ] **Step 5: Commit**

```bash
git add web/app/terminal/left-panel.tsx web/app/terminal/terminal.css
git commit -m "feat(web): panneaux Retards maintenant et Prochaines arrivées"
```

---

### Task 3: Panneau « INOUI / OUIGO »

**Files:**
- Modify: `web/app/terminal/right-panel.tsx`
- Modify: `web/app/terminal/terminal.css`

**Interfaces:**
- Consumes: `brandSplit`, `periodLabel` (`web/lib/terminal-model.ts`) ; props existantes de `RightPanel` (`stats`, `statsFailed`, `statsLoading`, `period`) et la constante locale `stale`.
- Produces: une `<section className={`term-panel${stale}`}>` ajoutée à la fin de `RightPanel`, sans changement de props.

- [ ] **Step 1: Ajouter le panneau** après « Régularité » : titre `INOUI / OUIGO {periodLabel(period)}` ; `INDISPONIBLE` si `statsFailed`, `…` si `stats` est nul ; liste vide donne `AUCUN TRAIN`.
- [ ] **Step 2: Contenu** : une ligne par marque (`dl`/liste, classe `term-small` si `small`) avec `trains`, régularité (`—` si `null`, sinon `pct` au format du panneau Régularité) et indemnités en `€ HT` arrondies (`nf(Math.round(cost))`). Dessous, deux lignes de barre empilée de 20 caractères, libellées `TRAINS` et `INDEMN.` : INOUI occupe `Math.round(share * 20 / 100)` caractères `█`, OUIGO le reste, avec deux classes de couleur (`brand-inoui` : `var(--t-amber)` ; `brand-ouigo` : `var(--t-amber-dim)`) ; une seule marque présente donne 20 caractères de cette marque.
- [ ] **Step 3: CSS** dans `terminal.css` : `.brand-split` (grille à colonnes alignées comme `.kpi-list`) et les deux classes de couleur ; la barre reprend `white-space: pre; letter-spacing: -1px`. Les nouveaux panneaux restent sous les panneaux existants sur mobile : ils héritent de `.term-panel { order: 3; }`, vérifier qu'aucune règle supplémentaire n'est nécessaire.
- [ ] **Step 4: Vérifier** : `cd web && npx tsc --noEmit && npx vitest run` ; attendu : propre.
- [ ] **Step 5: Commit**

```bash
git add web/app/terminal/right-panel.tsx web/app/terminal/terminal.css
git commit -m "feat(web): panneau INOUI / OUIGO (répartition sur la période)"
```

---

### Task 4: Vérification à l'écran

**Files:** aucun changement attendu (corriger ce que la vérification révèle, avec un commit par correction).

- [ ] **Step 1: Démarrer** `preview_start` avec `{name: "web"}` (port 3000) ; si `web/.next/cache/fetch-cache` date d'avant la dernière migration, l'arrêter, supprimer ce dossier, relancer.
- [ ] **Step 2: Bureau 1600×900** : `resize_window` 1600×900 ; lire les textes avec `javascript_tool` (les captures sont trop petites) : les trois titres existent, « Retards maintenant » compte autant de trains que « EN ROUTE » moins les supprimés, les 8 arrivées sont triées par heure, INOUI et OUIGO totalisent les trains de « Période ». La page ne défile pas (`document.documentElement.scrollHeight <= innerHeight`) ; si une colonne déborde, elle défile seule (`overflow-y: auto` existant).
- [ ] **Step 3: Interactions** : changer la période (14J) et vérifier que « INOUI / OUIGO » change et s'estompe pendant le chargement ; cliquer une ligne de « Prochaines arrivées » et vérifier que la fenêtre du train s'ouvre.
- [ ] **Step 4: Pannes** : `preview_start` avec `{name: "web-panne"}` (port 3001, base injoignable) : les trois panneaux affichent `INDISPONIBLE`, aucun n'est vide.
- [ ] **Step 5: Mobile** : `resize_window` en `mobile` ; pas de défilement horizontal (`scrollWidth <= innerWidth`) et les nouveaux panneaux viennent après les panneaux existants. Remettre `resize_window` en `desktop`.
- [ ] **Step 6: Résultat** : tests et typage une dernière fois ; présenter le diff à l'auteur et attendre son accord avant toute fusion (fusion `--ff-only`, branche supprimée, pas de push).
