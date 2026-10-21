# Tableau de bord Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page `/tableau` qui affiche, par marque et par axe, régularité, suppressions et répartition des retards sur une période choisie, avec l'effectif de chaque chiffre.

**Architecture:** Un modèle pur testé (`dashboard-model.ts`) et un composant client qui lit `/api/stats` (inchangée) ; les petits échantillons sont affichés estompés avec leur `n`. Aucun changement d'API, de base ni de cache.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Vitest, CSS simple.

**Spec:** `docs/superpowers/specs/2026-10-21-tableau-de-bord-design.md`

## Global Constraints

- `SAMPLE_MIN = 30` : un groupe ou un total dont `circulated` est inférieur à 30 est estompé et porte « échantillon trop petit » ; rien n'est masqué.
- Périodes : `7d` (défaut), `14d`, `31d`, puis un mois `AAAA-MM` de `2026-10` au mois courant (heure de Paris), du plus récent au plus ancien ; un seul paramètre à la fois (`?period=` ou `?month=`), sinon `/api/stats` répond 400.
- Tranches de retard au terminus, dans l'ordre : `0`, `1-4`, `5-14`, `15-29`, `30-59`, `60-119`, `120-179`, `180+` (minutes).
- Taux de suppression = `cancelled / (cancelled + circulated)` ; régularité = `official_regularity_pct` de l'API (approximation : les retards du flux vont par pas de 5 min) ; coût = `estimated_cost_eur_ht`, occupation lue dans `assumptions.occupancy`.
- Aucune dépendance neuve ; types `Group`, `Totals`, `StatsPayload` réutilisés de `web/lib/stats.ts`.
- Textes visibles en français, mode sombre, lisible à 375 px, vrai `<table>` avec `<caption>`, jamais la couleur seule.
- `/api/stats` et `/api/live` inchangés.

## Review Focus

- Période sans aucun train (`circulated = 0` partout) : chiffres clés à « — », tableau vide avec message, pas de `NaN` (Tasks 1 et 2).
- `official_regularity_pct` nul : « — » (Task 2).
- Seuil exact : 29 trains = estompé, 30 = normal (Task 1).
- Mois à cheval sur décembre/janvier dans le sélecteur (Task 1).
- `/api/stats` en échec ou réseau coupé : message et « Réessayer », jamais d'écran vide (Task 2, vérification manuelle).
- Changement rapide de période : une réponse lente d'une ancienne période n'écrase pas la nouvelle (Task 2).

---

### Task 1: Modèle du tableau de bord

**Files:**
- Create: `web/lib/dashboard-model.ts`
- Test: `web/tests/dashboard-model.test.ts`

**Interfaces:**
- Consumes: `Group` de `web/lib/stats.ts`.
- Produces:
  - `SAMPLE_MIN: number` (30)
  - `isSmallSample(t: { circulated: number }): boolean`
  - `suppressionPct(t: { cancelled: number; circulated: number }): number | null` — `null` si `cancelled + circulated = 0`, arrondi à 0,1
  - `TERMINUS_BUCKETS: string[]` — les huit tranches dans l'ordre
  - `bucketShares(buckets: Record<string, number>): { bucket: string; n: number; pct: number }[]` — une entrée par tranche de `TERMINUS_BUCKETS`, `pct` arrondi à 0,1, tout à 0 si le total est nul
  - `monthOptions(now: Date, first?: string): string[]` — `first` = `'2026-10'` par défaut ; mois `AAAA-MM` du plus récent au plus ancien, selon la date à Paris
  - `sortGroups(groups: Group[]): Group[]` — marque puis axe, sans modifier l'argument

- [ ] **Step 1: Write the failing tests** dans `web/tests/dashboard-model.test.ts` :
  - `isSmallSample` : 29 → vrai, 30 → faux, 0 → vrai.
  - `suppressionPct` : `{ cancelled: 2, circulated: 71 }` → `2,7` ; `{ cancelled: 0, circulated: 0 }` → `null` ; `{ cancelled: 5, circulated: 0 }` → `100`.
  - `bucketShares` : `{ '0': 31, '1-4': 0, '5-14': 9, '15-29': 10, '30-59': 7, '60-119': 12, '120-179': 1, '180+': 1 }` → huit entrées dans l'ordre de `TERMINUS_BUCKETS`, `pct` de `'0'` = 43,7 ; toutes tranches à 0 → huit entrées à `pct: 0` (pas de `NaN`) ; une tranche absente de l'objet compte pour 0.
  - `monthOptions(new Date('2026-12-15T12:00:00Z'))` → `['2026-12', '2026-11', '2026-10']` ; `monthOptions(new Date('2027-01-02T12:00:00Z'))` → `['2027-01', '2026-12', '2026-11', '2026-10']` ; `monthOptions(new Date('2026-10-21T12:00:00Z'))` → `['2026-10']` ; `monthOptions(new Date('2026-11-30T23:30:00Z'))` → commence par `'2026-12'` (il est déjà le 1er décembre à Paris).
  - `sortGroups` : `[OUIGO EST, INOUI SUD_EST, INOUI EST]` → `[INOUI EST, INOUI SUD_EST, OUIGO EST]` et le tableau d'entrée est inchangé.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/dashboard-model.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** les fonctions dans `web/lib/dashboard-model.ts` ; le mois courant se lit avec `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' })` (ou `formatToParts`).
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npx vitest run` — Expected: tout passe.
- [ ] **Step 5: Commit** — `feat: modèle du tableau de bord (échantillons, suppressions, tranches, mois)`

### Task 2: Page du tableau de bord et navigation

**Files:**
- Create: `web/app/tableau/page.tsx`, `web/app/tableau/tableau-view.tsx`, `web/app/tableau/tableau.css`
- Modify: `web/app/layout.tsx` (import de `./tableau/tableau.css`), `web/app/carte-view.tsx` (lien « Tableau de bord »), `README.md`

**Interfaces:**
- Consumes: `isSmallSample`, `suppressionPct`, `bucketShares`, `monthOptions`, `sortGroups`, `TERMINUS_BUCKETS`, `SAMPLE_MIN` (Task 1) ; `StatsPayload`, `Group` (`web/lib/stats.ts`) ; `GET /api/stats?period=…|month=…`.
- Produces: composant client `TableauView(): JSX.Element` (`'use client'`, sans props) ; page `/tableau`.

- [ ] **Step 1: Implement `TableauView`.** État : période (`'7d' | '14d' | '31d' | 'AAAA-MM'`), données, erreur, chargement. Chargement avec `fetch('/api/stats?' + (période commence par un chiffre suivi de `d` ? 'period=' : 'month=') + valeur)` ; un compteur de requête ignore les réponses d'une période devenue obsolète ; erreur ou réponse non valide : message + bouton « Réessayer ». Affichage : titre, sélecteur de période (libellés « 7 derniers jours », « 14 derniers jours », « 31 derniers jours », puis « octobre 2026 »…), période `from` – `to`, bandeau d'avertissement (collecte commencée le 20 octobre 2026 ; régularité approchée ; échantillons de moins de 30 trains estompés), quatre chiffres clés (`circulated`, régularité, taux de suppression, coût estimé en € HT avec l'occupation de `assumptions`), tableau des groupes (`<caption>`, colonnes : marque, axe, trains ayant circulé, régularité, suppressions, répartition des retards au terminus, coût estimé), barre empilée par tranche avec les pourcentages en texte accessible (`title` et texte masqué visuellement), ligne estompée + « échantillon trop petit » sous `SAMPLE_MIN`, « — » pour une valeur nulle, message « Aucun train sur cette période » si aucun groupe, note de bas de page avec les prix de référence HT et l'occupation lus dans `assumptions`, lien « Carte » vers `/`.
- [ ] **Step 2: Implement** `page.tsx` (titre de page « Tableau de bord », rend `<TableauView />`), `tableau.css` (jetons de couleur en variables CSS, redéfinis sous `prefers-color-scheme: dark`, mobile 375 px sans défilement horizontal de la page : le tableau défile dans son conteneur), import dans `layout.tsx`, lien « Tableau de bord » dans la barre de `carte-view.tsx`, courte mention dans le README (section « Carte » ou nouvelle section « Tableau de bord »).
- [ ] **Step 3: Verify build** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe, `/tableau` listée dans la sortie de build.
- [ ] **Step 4: Vérifier à la main** (`npx next dev` à la racine via la configuration de prévisualisation, navigateur intégré) : changer de période (7j, 31j, mois) met à jour les chiffres ; lignes sous 30 trains estompées avec la mention ; « — » pour les valeurs nulles ; couper le réseau (fetch rejeté) affiche le message et « Réessayer » qui relance ; rendu correct à 375 px et en mode sombre ; lien Carte ⇄ Tableau de bord fonctionnel. Consigner ce qui a été vu dans `docs/findings/2026-10-21-tableau.md`.
- [ ] **Step 5: Commit** — `feat: tableau de bord par marque et par axe`

### Task 3: Mise en ligne

**Files:**
- Modify: `docs/findings/2026-10-21-tableau.md`

**Interfaces:**
- Consumes: Tasks 1 et 2.
- Produces: `/tableau` en production sur `https://sncf-tracking.vercel.app`.

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 1.**

- [ ] **Step 1: Après accord**, fusion rapide de la branche dans `main`, `git push origin main`, puis `vercel deploy --prod --yes` depuis la racine du dépôt.
- [ ] **Step 2: Vérifier en production** : `curl -s -o /dev/null -w '%{http_code}' https://sncf-tracking.vercel.app/tableau` renvoie 200 ; la page affiche les chiffres dans le navigateur intégré, sans erreur console ; consigner dans les findings, commit et push (après accord) — `docs: vérification du tableau de bord en production`.

---

**Plans suivants** : 4c (méthodologie et téléchargements), puis 4b (compteur cumulé, table de cumuls journaliers). Point reporté : causes de retard par axe (aucune agrégation en base aujourd'hui).
