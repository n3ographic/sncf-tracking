# Statistiques du tableau sur l'écran terminal — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher toutes les statistiques de `/tableau` sur l'écran d'accueil (disposition B, grille de trading) avec un sélecteur de période global, puis retirer `/tableau`.

**Architecture:** `TerminalView` garde le chargement unique et ajoute un état `period` qui recharge `/api/stats`. La colonne centrale devient « carte + panneau marque × axe ». Trois fonctions pures nouvelles dans `terminal-model.ts`, testées d'abord. Aucun changement d'API ni de base.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest, MapLibre (inchangé).

**Spec:** `docs/superpowers/specs/2026-10-22-home-stats-terminal-design.md`

## Global Constraints

- Aucun changement d'API, de clé de cache, de migration ni de route `/api/*`.
- Seuil d'échantillon : `SAMPLE_MIN = 30` trains ayant circulé (réutiliser `isSmallSample`) ; estompé, jamais masqué.
- Période par défaut : `7d`. Valeurs : `7d`, `14d`, `31d`, ou un mois `AAAA-MM` de `monthOptions(new Date())`.
- Tranches de retard au terminus : `TERMINUS_BUCKETS` de `dashboard-model.ts`, couleurs `--seg0` … `--seg7` actuelles (`#3ad13a #8fd13a #ffd24d #ffb000 #ff8c00 #ff4d4d #d12f2f #8f1d1d`).
- Libellés en majuscules, style terminal existant (`term-panel`, `term-panel-title`, `term-dim`, `term-small`).
- Ordinateur (≥ 900 px) : aucun défilement de la page. Mobile (< 900 px) : aucun défilement horizontal de la page.
- Ne jamais lancer `npm run build` pendant que `next dev` tourne (`.next` partagé) : arrêter le serveur, supprimer `web/.next`, relancer.
- Un push sur `main` déploie en production : ne pas pousser sans accord de l'auteur.

## Review Focus

1. Changements de période rapides (7J → 31J → OCT.) : la dernière période choisie doit l'emporter, jamais une réponse arrivée en retard (compteur de séquence) — vérification navigateur, tâche 2.
2. Mois sans aucune donnée (mois courant tout juste commencé, ou groupe vide) : « AUCUN TRAIN SUR CETTE PÉRIODE », pas de tableau vide ni de « NaN » — tâche 3.
3. Écran d'ordinateur bas (1280×720) : toujours pas de défilement de page, le tableau défile dans son panneau et garde au moins 4 lignes visibles — tâche 3.
4. Groupe dont presque tous les trains sont dans une tranche et un seul dans une autre : la barre fait exactement `width` caractères, la petite tranche peut disparaître mais reste dans l'`aria-label` — test `bucketBar`, tâche 1.
5. `/api/stats` en échec alors que `/api/live` fonctionne : panneaux de stats « INDISPONIBLE », carte et bandeau normaux, « RÉESSAYER » relance — vérification avec base injoignable, tâche 5.

---

### Task 1: Fonctions pures de période et de barre

**Files:**
- Modify: `web/lib/terminal-model.ts` (ajout en fin de fichier)
- Test: `web/tests/terminal-model.test.ts`

**Interfaces:**
- Produces :
  - `export type Period = string;` (`'7d' | '14d' | '31d'` ou `'AAAA-MM'`)
  - `export const FIXED_PERIODS = ['7d', '14d', '31d'] as const;`
  - `periodQuery(p: Period): string`
  - `periodLabel(p: Period): string`
  - `bucketBar(buckets: Record<string, number>, width: number): { i: number; bucket: string; len: number }[]` — `i` est l'index dans `TERMINUS_BUCKETS`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test('periodQuery : jours en period, mois en month', () => {
  expect(periodQuery('7d')).toBe('period=7d');
  expect(periodQuery('31d')).toBe('period=31d');
  expect(periodQuery('2026-10')).toBe('month=2026-10');
});

test('periodLabel : 7J, 14J, 31J, mois abrégé en majuscules', () => {
  expect(['7d', '14d', '31d'].map(periodLabel)).toEqual(['7J', '14J', '31J']);
  expect(periodLabel('2026-10')).toBe('OCT. 2026');
  expect(periodLabel('2027-02')).toBe('FÉVR. 2027');
  expect(periodLabel('2027-05')).toBe('MAI 2027');
});

test('bucketBar : largeur exacte, plus forts restes, vide sans train', () => {
  const sum = (s: { len: number }[]) => s.reduce((a, x) => a + x.len, 0);
  expect(bucketBar({}, 12)).toEqual([]);
  const even = bucketBar({ '0': 1, '5-14': 1, '60-119': 1 }, 12);
  expect(even.map((s) => [s.i, s.len])).toEqual([[0, 4], [2, 4], [5, 4]]);
  const skew = bucketBar({ '0': 99, '180+': 1 }, 12);
  expect(sum(skew)).toBe(12);
  expect(skew.every((s) => s.len > 0)).toBe(true);
  expect(sum(bucketBar({ '0': 1, '1-4': 1, '5-14': 1 }, 10))).toBe(10);
});
```

Ajouter `periodQuery, periodLabel, bucketBar` à l'import existant.

- [ ] **Step 2: Lancer les tests, constater l'échec**

Run: `cd web && npx vitest run tests/terminal-model.test.ts`
Expected: FAIL (`periodQuery is not a function` ou erreur d'import).

- [ ] **Step 3: Implémenter dans `web/lib/terminal-model.ts`**

- `periodQuery` : reprendre `query` de `tableau-view.tsx` (`/^\d+d$/` → `period=`, sinon `month=`).
- `periodLabel` : `Nd` → `NJ` ; mois → abréviation fixe + année, table exacte : `JANV. FÉVR. MARS AVR. MAI JUIN JUIL. AOÛT SEPT. OCT. NOV. DÉC.`
- `bucketBar` : méthode des plus forts restes sur `TERMINUS_BUCKETS` (`floor(n/total*width)`, puis +1 aux plus grands restes, à égalité l'index le plus petit), segments de longueur 0 retirés, ordre des tranches conservé. Importer `TERMINUS_BUCKETS` depuis `./dashboard-model`.

- [ ] **Step 4: Lancer les tests, constater le succès**

Run: `cd web && npx vitest run`
Expected: tous les tests passent (109 + 3).

- [ ] **Step 5: Commit**

```bash
git add web/lib/terminal-model.ts web/tests/terminal-model.test.ts
git commit -m "feat: période et barre de tranches pour l'écran terminal"
```

---

### Task 2: Sélecteur de période et panneaux pilotés par la période

**Files:**
- Create: `web/app/terminal/period-picker.tsx`
- Modify: `web/app/terminal/status-bar.tsx`, `web/app/terminal/terminal-view.tsx`, `web/app/terminal/left-panel.tsx`, `web/app/terminal/right-panel.tsx`, `web/app/terminal/terminal.css`

**Interfaces:**
- Consumes : `Period`, `FIXED_PERIODS`, `periodQuery`, `periodLabel` (tâche 1) ; `monthOptions`, `isSmallSample`, `suppressionPct` (`dashboard-model`).
- Produces :
  - `PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void })`
  - `StatusBar` reçoit en plus `picker?: React.ReactNode`, rendu après l'horloge (la page méthodologie ne le passe pas).
  - Dans `TerminalView` : états `period: Period` (défaut `'7d'`), `stats`, `statsFailed`, `statsLoading: boolean`, et `reloadStats: () => void` ; `LeftPanel` et `RightPanel` reçoivent `period: Period` et `statsLoading: boolean`.

- [ ] **Step 1: `PeriodPicker`** — `<div role="group" aria-label="Période">` : un bouton par `FIXED_PERIODS` (texte `periodLabel`, `aria-pressed` si sélectionné), puis `<select aria-label="Mois">` avec une option vide « MOIS » et les mois de `monthOptions(new Date())` (texte `periodLabel`) ; valeur du select = `value` si c'est un mois, sinon `''`. Style : bouton sélectionné en bloc ambre inversé (comme `.term-logo`), autres en filet `--t-line`.

- [ ] **Step 2: Chargement par période dans `TerminalView`** — remplacer le chargement fixe `period=7d` par un effet sur `period` : `fetch('/api/stats?' + periodQuery(period))`, compteur de séquence `useRef` comme `load` de `tableau-view.tsx` (seule la dernière demande écrit l'état), `statsLoading` vrai pendant la requête, anciennes `stats` conservées. `reloadStats` relance la période courante. Passer `<PeriodPicker value={period} onChange={setPeriod} />` à `StatusBar` via `picker`.

- [ ] **Step 3: Panneau gauche** — « TAUX 7J » devient `TAUX ${periodLabel(period)}`.

- [ ] **Step 4: Panneau droit** — nouvelle section en tête, titre « PÉRIODE » suivi de `periodLabel(period)` : `TRAINS` (`circulated`), `RÉGUL.` (`official_regularity_pct`), `SUPPR.` (`suppressionPct`), `INDEMN.` (`estimated_cost_eur_ht`, arrondi, « € HT ») ; classe `term-small` si `isSmallSample(stats.totals)` ; « INDISPONIBLE » si échec, « … » avant la première réponse. Section « RÉGULARITÉ 7J » → `RÉGULARITÉ ${periodLabel(period)}`. Sections de stats en classe `term-stale` (opacité 0,55) pendant `statsLoading` avec des données déjà affichées.

- [ ] **Step 5: Vérifier dans le navigateur (serveur de dev)**

Run: `preview_start web`, puis à 1440×900 : cliquer 14J, 31J, puis choisir le mois courant.
Expected: les titres passent à « PÉRIODE 14J », « RÉGULARITÉ 31J », « TAUX OCT. 2026 » ; les valeurs changent ; `aria-pressed` suit. En enchaînant 31J, 7J puis le mois en moins d'une seconde, l'affichage final correspond au mois (Review Focus 1).

- [ ] **Step 6: Commit**

```bash
git add web/app/terminal/
git commit -m "feat: sélecteur de période global sur l'écran terminal"
```

---

### Task 3: Panneau marque × axe sous la carte

**Files:**
- Create: `web/app/terminal/groups-panel.tsx`
- Modify: `web/app/terminal/terminal-view.tsx`, `web/app/terminal/terminal.css`, `web/app/carte.css` (si la hauteur minimale de `.carte-map` empêche la grille)

**Interfaces:**
- Consumes : `bucketBar`, `periodLabel` (tâche 1) ; `sortGroups`, `isSmallSample`, `suppressionPct`, `bucketShares`, `TERMINUS_BUCKETS` (`dashboard-model`) ; `stats`, `statsFailed`, `statsLoading`, `period`, `reloadStats` (tâche 2).
- Produces : `GroupsPanel({ stats, failed, loading, period, onRetry }: { stats: StatsPayload | null; failed: boolean; loading: boolean; period: Period; onRetry: () => void })`.

- [ ] **Step 1: `GroupsPanel`** — `<section className="term-panel groups" aria-labelledby=…>` titre « MARQUE × AXE » + `periodLabel`. Corps `<div className="groups-scroll" tabIndex={0} role="region" aria-label="Tableau par marque et par axe">` contenant la `<table>` de `tableau-view.tsx` (mêmes 7 colonnes, `caption` en `sr-only`, `scope`), en-tête `position: sticky; top: 0`. Colonne terminus : `<span role="img" aria-label="Retard au terminus : …">` (même libellé que `Bar` de `tableau-view.tsx`) contenant un `<span className={`seg-c s${i}`}>` de `'█'.repeat(len)` par segment de `bucketBar(g.terminus_buckets, 12)`. Ligne `term-small` et mention « n<30 » si `isSmallSample(g)`. États : échec → « INDISPONIBLE » + bouton « RÉESSAYER » (`onRetry`) ; aucun groupe → « AUCUN TRAIN SUR CETTE PÉRIODE » ; `loading` avec données → `term-stale`. Pied en `term-dim`, une ligne : légende des tranches (pastille `seg-c` + libellé « 0 », « 1-4 »… « MIN »), « DU jj/mm AU jj/mm », « RÉGULARITÉ APPROCHÉE · PAS DE 5′ · COLLECTE DEPUIS LE 20/10 », prix de référence `stats.assumptions.prices` et occupation.

- [ ] **Step 2: Grille** — dans `TerminalView`, envelopper `CarteView` et `GroupsPanel` dans `<div className="term-center">`. CSS : `.term-center { display: flex; flex-direction: column; gap: 6px; min-height: 0; }`, carte `flex: 62 1 0`, `.groups { flex: 38 1 0; min-height: 150px; display: flex; flex-direction: column; }`, `.groups-scroll { flex: 1; overflow: auto; }`, `.carte-map { min-height: 0 }` dans ce contexte. Déplacer dans `terminal.css` les variables `--seg0…7` (sur `:root`) et les classes `.s0…s7` en version texte : `.seg-c.sN { color: var(--segN); }`.

- [ ] **Step 3: Mobile (< 900 px)** — `.term-col, .term-center { display: contents; }` ; ordre : `.carte` 0, section « PÉRIODE » 1 (classe `period-panel`), `.groups` 2, autres panneaux 3 ; `.groups` hauteur libre (`flex: none`), `.groups-scroll` défilement horizontal seulement.

- [ ] **Step 4: Vérifier dans le navigateur**

Run: `resize_window` 1440×900, 1280×720, puis 375×812 (`preset: mobile`, recharger).
Expected: ordinateur — `document.documentElement.scrollHeight <= innerHeight` (via `javascript_tool`), tableau visible sous la carte avec au moins 4 lignes à 1280×720, défilement interne ; mobile — ordre carte, PÉRIODE, tableau, `scrollWidth <= innerWidth`. Aucun mois sans données n'est sélectionnable (la collecte commence en 2026-10) : le cas vide (Review Focus 2) se contrôle à la relecture, la branche `groups.length === 0` doit rendre exactement « AUCUN TRAIN SUR CETTE PÉRIODE ».

- [ ] **Step 5: Commit**

```bash
git add web/app/terminal/ web/app/carte.css
git commit -m "feat: panneau marque × axe sous la carte"
```

---

### Task 4: Retrait de `/tableau`

**Files:**
- Modify: `web/app/tableau/page.tsx`, `web/app/layout.tsx`, `web/app/terminal/foot-bar.tsx`, `README.md`
- Delete: `web/app/tableau/tableau-view.tsx`, `web/app/tableau/cumul-banner.tsx`, `web/app/tableau/tableau.css`

**Interfaces:**
- Consumes : rien de nouveau.

- [ ] **Step 1: Redirection** — `page.tsx` : `import { permanentRedirect } from 'next/navigation'; export default function Page() { permanentRedirect('/'); }`.

- [ ] **Step 2: Nettoyage** — supprimer les trois fichiers, l'import `./tableau/tableau.css` de `layout.tsx` ; pied de page : `F1 CARTE`, `F2 MÉTHODO` ; README ligne 122 : décrire l'écran d'accueil (sélecteur de période, panneau marque × axe) au lieu de `/tableau` ; `git grep -n "/tableau"` ne doit plus renvoyer que la redirection.

- [ ] **Step 3: Vérifier**

Run: `cd web && npx vitest run && npx tsc --noEmit`, puis `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/tableau`
Expected: tests verts, typage OK, `308 http://localhost:3000/`.

- [ ] **Step 4: Commit**

```bash
git add -A web/app/tableau web/app/layout.tsx web/app/terminal/foot-bar.tsx README.md
git commit -m "feat: /tableau redirige vers l'écran terminal"
```

---

### Task 5: Vérification complète, build et compte rendu

**Files:**
- Create: `docs/findings/2026-10-22-home-stats.md`

- [ ] **Step 1: Panne de la base** — arrêter le serveur de dev, lancer `SUPABASE_URL=http://127.0.0.1:9 npx next dev -p 3001` (vider `web/.next/cache/fetch-cache` avant). Expected : panneaux de stats « INDISPONIBLE », « RÉESSAYER » présent et relance la requête, page intacte, pas de défilement (Review Focus 5). Arrêter ce serveur.

- [ ] **Step 2: Build** — serveur de dev arrêté, `rm -rf web/.next && cd web && npm run build`. Expected : build réussi, `/tableau` listé.

- [ ] **Step 3: Compte rendu** — `docs/findings/2026-10-22-home-stats.md` : ce qui a été vérifié (tailles d'écran, périodes, panne, redirection), valeurs observées, limites.

- [ ] **Step 4: Commit**

```bash
git add docs/findings/2026-10-22-home-stats.md
git commit -m "docs: vérification des statistiques sur l'écran terminal"
```

- [ ] **Step 5: Déploiement (accord de l'auteur requis)** — `vercel deploy --prod --yes` depuis la racine (ou push sur `main`, qui déploie aussi), puis en production : `/` sans défilement à 1440×900, changement de période, `curl -sI https://sncf-tracking.vercel.app/tableau` → 308 vers `/`.
