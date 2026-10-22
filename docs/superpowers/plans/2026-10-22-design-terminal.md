# Design terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'interface en écran unique façon terminal boursier (noir et ambre), carte au centre entourée de panneaux, et habiller le tableau de bord et la méthodologie dans le même thème.

**Architecture:** Un modèle pur testé (`terminal-model.ts`) prépare les données des panneaux ; un composant client `TerminalView` charge une fois `/api/live` (toutes les 60 s), `/api/cumul` et `/api/stats?period=7d` et les distribue aux panneaux ; la carte actuelle devient un panneau qui reçoit ses trains en props et accepte une demande de centrage. Aucun changement de base, d'API ni de cache.

**Tech Stack:** Next.js 15 (App Router, `next/font/google`), React 19, TypeScript, MapLibre GL 6.15.0, Vitest, CSS sans framework.

**Spec:** `docs/superpowers/specs/2026-10-22-design-terminal-design.md`

## Global Constraints

- Thème sombre unique ; jetons CSS : fond `#0a0a0a`, panneau `#0f0f0f`, ambre `#ffb000`, ambre atténué `#b07c00`, filets `#4a3200`, à l'heure `#3ad13a`, retard `#ffd24d`, fort retard `#ff8c00`, très fort retard `#ff4d4d`, annulé `#8a8a8a`.
- Tons de retard : `ontime` < 300 s, `late` 300–1 799 s, `strong` 1 800–3 599 s, `severe` ≥ 3 600 s, `cancelled` prioritaire ; les classes de la carte (`delayClass`) et leurs seuils restent inchangés.
- Police IBM Plex Mono via `next/font/google` (poids 400 et 600), aucun appel externe à l'exécution ; fond de carte `https://tiles.openfreemap.org/styles/dark`.
- Collecte « OK » si le `last_seen_at` le plus récent a moins de 600 s, sinon « EN RETARD » ; « INCONNU » si `/api/live` échoue.
- Seuil d'estompage : 30 trains ayant circulé (`SAMPLE_MIN`).
- Pas d'ombre, de dégradé ni de lueur ; focus visible (contour ambre 1 px) ; bandeau pausable au survol et au focus, statique sous `prefers-reduced-motion: reduce`.
- ≥ 900 px : grille trois colonnes ; < 900 px : empilement, carte à 60 vh, filtres dans un volet repliable ; aucun défilement horizontal de la page.
- Aucune dépendance neuve ; `/api/*`, la base et les données inchangées ; textes visibles en français.

## Review Focus

- `/api/live`, `/api/cumul` ou `/api/stats` en échec : chaque panneau affiche « INDISPONIBLE » ou « — » sans bloquer les autres ni la carte (Task 3, vérification manuelle).
- Aucun train en circulation (nuit) : bandeau, top et compteurs vides proprement, sans erreur (Tasks 1 et 3).
- Train annulé avec un gros retard : jamais dans le top des retards ni le bandeau, compté dans les suppressions (Task 1).
- Clic dans le top des retards sur un train sans position estimée : rien ne se passe, pas d'erreur (Task 3).
- 375 px : aucune barre ni panneau ne déborde (Task 5).

---

### Task 1: Modèle du terminal

**Files:**
- Create: `web/lib/terminal-model.ts`
- Test: `web/tests/terminal-model.test.ts`

**Interfaces:**
- Consumes: `LiveItem` (`web/lib/map-model.ts`), `Group` (`web/lib/stats.ts`), `SAMPLE_MIN` (`web/lib/dashboard-model.ts`).
- Produces:
  - `type Tone = 'ontime' | 'late' | 'strong' | 'severe' | 'cancelled'`
  - `delayTone(delay_s: number | undefined, cancelled: boolean): Tone`
  - `topDelays(trains: LiveItem[], n: number): LiveItem[]` — non annulés, `delay_s` décroissant, puis numéro de train ; retard absent compté comme 0 et exclu s'il vaut 0
  - `tickerItems(trains: LiveItem[], n: number): { trip_id: string; label: string; minutes: number; tone: Tone }[]` — à partir de `topDelays` ; `label` = `"${brand} ${train_number} ${origin} → ${dest}"` (origine ou destination absente : omise)
  - `collectStatus(trains: LiveItem[], now: Date): { status: 'ok' | 'late' | 'unknown'; ageMin: number | null }` — `unknown` sans train ni `last_seen_at`
  - `axisRegularity(groups: Group[]): { axis: string; circulated: number; on_time: number; pct: number | null; small: boolean }[]` — somme des marques par axe, tri par axe, `pct` arrondi à 0,1
  - `charBar(pct: number | null, width: number): string` — `width` caractères au plus, `█` pleins et `▌` pour une demi-cellule, chaîne vide pour `null` ou 0

- [ ] **Step 1: Write the failing tests** : `delayTone` aux bornes (299 → `ontime`, 300 → `late`, 1 799 → `late`, 1 800 → `strong`, 3 599 → `strong`, 3 600 → `severe`, absent → `ontime`, annulé avec 9 000 → `cancelled`) ; `topDelays` exclut les annulés et les retards nuls ou absents, trie 230 > 170 > 100, coupe à `n`, liste vide → `[]` ; `tickerItems` construit le libellé `INOUI 9713 Paris → Barcelone`, omet une destination absente, minutes arrondies (`delay_s` 13 800 → 230) ; `collectStatus` : `last_seen_at` à 9 min → `ok` et `ageMin` 9, à 11 min → `late`, aucun train → `unknown` ; `axisRegularity` : deux marques sur un axe (19 + 4 ayant circulé, 14 + 3 à l'heure) → `circulated` 23, `pct` 73,9, `small` vrai (23 < 30), axe sans train ayant circulé → `pct` nul ; `charBar(100, 10)` → 10 `█`, `charBar(50, 10)` → 5 `█`, `charBar(55, 10)` → 5 `█` et un `▌`, `charBar(0, 10)` et `charBar(null, 10)` → `''`.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/terminal-model.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** les fonctions dans `web/lib/terminal-model.ts`.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npx vitest run` — Expected: tout passe.
- [ ] **Step 5: Commit** — `feat: modèle du terminal (tons de retard, top, bandeau, fraîcheur, régularité par axe)`

### Task 2: Thème, police et cadre commun

**Files:**
- Create: `web/app/terminal/terminal.css`, `web/app/terminal/status-bar.tsx`, `web/app/terminal/foot-bar.tsx`
- Modify: `web/app/layout.tsx` (police IBM Plex Mono via `next/font/google`, import de `terminal.css`, suppression de la variante claire), `web/app/carte.css` (jetons du terminal, suppression du thème clair)

**Interfaces:**
- Consumes: `collectStatus` (Task 1).
- Produces:
  - `StatusBar({ status, coveragePct }: { status: { status: 'ok' | 'late' | 'unknown'; ageMin: number | null } | null; coveragePct: number | null }): JSX.Element` — bloc « OBS·TGV », horloge à la seconde (heure de Paris, mise à jour chaque seconde côté client), état de la collecte, couverture
  - `FootBar(): JSX.Element` — liens `/`, `/tableau`, `/methodologie` libellés « F1 CARTE », « F2 TABLEAU », « F3 MÉTHODO », mention « POSITIONS ESTIMÉES · NON AFFILIÉ SNCF/OUIGO »
  - classes CSS : `.term` (racine), `.term-panel`, `.term-panel-title`, `.tone-ontime|late|strong|severe|cancelled`, `.term-dim`

- [ ] **Step 1: Implement** les jetons en variables CSS sur `:root` (Global Constraints), la police (`--font-term` appliquée au `body`), les classes communes, `StatusBar` et `FootBar` ; focus visible ; aucune règle `prefers-color-scheme: light`.
- [ ] **Step 2: Verify** `cd web && npx tsc --noEmit && npm run build` — Expected: build OK, la police est servie depuis le site (`/_next/static/media/`).
- [ ] **Step 3: Commit** — `feat: thème terminal, police et barres communes`

### Task 3: Écran principal

**Files:**
- Create: `web/app/terminal/terminal-view.tsx`, `web/app/terminal/ticker.tsx`, `web/app/terminal/left-panel.tsx`, `web/app/terminal/right-panel.tsx`
- Modify: `web/app/carte-view.tsx` (ne charge plus `/api/live` ni `/api/cumul` : reçoit `trains`, `failed`, `lastOk` en props et une demande de centrage ; fond `dark`, voies ambre foncé, fenêtre au style terminal, filtres et case des voies dans une ligne au-dessus de la carte, compteur sous la carte), `web/app/page.tsx` (rend `TerminalView`)

**Interfaces:**
- Consumes: Task 1 (toutes les fonctions), Task 2 (`StatusBar`, `FootBar`, classes), `LiveItem`, `Cumul`, `StatsPayload`.
- Produces:
  - `TerminalView(): JSX.Element` — charge `/api/live` au montage puis toutes les 60 s (garde les derniers trains en cas d'échec), `/api/cumul` et `/api/stats?period=7d` une fois ; chaque chargement a son propre état d'erreur
  - `CarteView({ trains, failed, lastOk, focus }: { trains: LiveItem[]; failed: boolean; lastOk: number | null; focus: { trip_id: string; at: number } | null })` — sur un nouveau `focus`, centre la carte sur la position estimée du train (zoom 8) et ouvre sa fenêtre ; sans position, ne fait rien
  - `Ticker({ items })`, `LeftPanel({ trains, stats, onFocus })`, `RightPanel({ cumul, cumulFailed, stats, statsFailed })`

- [ ] **Step 1: Refactor `CarteView`** pour recevoir ses données en props (supprimer ses `fetch` de `/api/live` et `/api/cumul`), garder le chargement des tracés, ajouter le centrage par `focus`, appliquer le fond `dark`, la couleur des voies `#7a5200`, les couleurs de points par ton (`delayTone`, via une propriété `tone` ajoutée aux features dans `CarteView` sans modifier `toFeatureCollection`) et la fenêtre au style terminal (nœuds DOM, jamais de HTML).
- [ ] **Step 2: Implement** `Ticker` (animation CSS de translation, pause au survol et au focus, statique sous `prefers-reduced-motion`), `LeftPanel` (top 10 cliquable → `onFocus`, suppressions en cours, taux de suppression 7 j depuis `totals`), `RightPanel` (compteur cumulé avec couverture et « observé seulement », régularité par axe avec `charBar`, « n<30 » estompé), `TerminalView` (grille trois colonnes ≥ 900 px) et `page.tsx`.
- [ ] **Step 3: Verify** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe.
- [ ] **Step 4: Vérifier à la main** (prévisualisation, navigateur intégré, données réelles) : barre d'état et heure, bandeau qui défile et se met en pause, top des retards qui centre la carte, carte sombre avec voies et points colorés, panneaux de droite remplis ; échec simulé de chaque API (fetch rejeté par URL) : seul le panneau concerné passe en « INDISPONIBLE ». Consigner dans `docs/findings/2026-10-22-design-terminal.md`.
- [ ] **Step 5: Commit** — `feat: écran terminal (bandeau, panneaux, carte au centre)`

### Task 4: Tableau de bord et méthodologie au thème terminal

**Files:**
- Modify: `web/app/tableau/tableau-view.tsx`, `web/app/tableau/cumul-banner.tsx`, `web/app/tableau/tableau.css`, `web/app/methodologie/page.tsx`, `web/app/methodologie/methodologie.css`

**Interfaces:**
- Consumes: `StatusBar`, `FootBar`, jetons et classes (Task 2).
- Produces: les deux pages dans le thème, structure et contenu inchangés.

- [ ] **Step 1: Implement** : barre d'état (sans état de collecte sur la méthodologie : `status` à `null`) et barre du bas sur les deux pages ; panneaux, tableaux, barres empilées et avertissements dans les jetons du terminal ; titres de panneau en blocs ambre.
- [ ] **Step 2: Verify** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe.
- [ ] **Step 3: Commit** — `feat: tableau de bord et méthodologie au thème terminal`

### Task 5: Mobile, vérification d'ensemble et mise en ligne

**Files:**
- Modify: `web/app/terminal/terminal.css`, `web/app/terminal/terminal-view.tsx` (volet « FILTRES »), `README.md`, `docs/findings/2026-10-22-design-terminal.md`

**Interfaces:**
- Consumes: Tasks 1 à 4.
- Produces: interface terminal en production.

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 3.**

- [ ] **Step 1: Implement** l'empilement < 900 px (carte à 60 vh, panneaux en dessous, filtres dans un volet repliable), mention du design au README.
- [ ] **Step 2: Vérifier à la main** à 1 440 px, 1 024 px et 375 px (aucun défilement horizontal : `scrollWidth` = largeur), `/tableau` et `/methodologie` dans le thème, contraste de l'ambre atténué (≥ 4,5:1), focus clavier visible ; consigner ; commit — `feat: terminal sur mobile`. Montrer le rendu à l'auteur avant la suite.
- [ ] **Step 3: Après accord**, fusion dans `main`, `git push origin main`, `vercel deploy --prod --yes` depuis la racine ; vérifier `/`, `/tableau`, `/methodologie` en production sans erreur console ; consigner, commit et push — `docs: vérification du design terminal en production`.
