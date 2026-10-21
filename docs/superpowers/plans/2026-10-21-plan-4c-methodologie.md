# Méthodologie et règles téléchargeables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page `/methodologie` qui explique ce que mesure l'observatoire avec les règles lues dans la base, et une route `GET /api/rules` qui les renvoie en JSON.

**Architecture:** Une fonction partagée `loadRules(deps)` lit les trois tables de règles derrière le cache de données de Next (clé fixe `['rules', 'v1']`, 3 600 s) ; la route et la page serveur l'utilisent. Un module pur `shapeRules` convertit et trie. Aucun changement de base, ni de pipeline.

**Tech Stack:** Next.js 15 (App Router, composant serveur), TypeScript, Vitest, supabase-js (clé publique).

**Spec:** `docs/superpowers/specs/2026-10-21-methodologie-design.md`

## Global Constraints

- Tables lues avec la clé `anon` uniquement : `compensation_scale`, `regularity_rule`, `reference_prices` ; aucune écriture, aucune migration.
- Route `GET /api/rules` : aucun paramètre (tout paramètre : `400`, `Cache-Control: no-store`) ; succès `public, s-maxage=3600, stale-while-revalidate=600` ; erreur de lecture : `502`, `no-store`, jamais mise en cache.
- Réponse : `{ generated_at, compensation_scale, regularity_rule, reference_prices }`, valeurs numériques converties en nombres (`toNum` de `web/lib/num.ts`), tri : barème par marque puis `from_s`, régularité par `duration_from_s`, prix par marque.
- Cache de données : clé `['rules', 'v1']`, `3600` s ; une exception n'est jamais mise en cache (comme `Deps.cached`).
- La page ne plante jamais si la lecture échoue : message « règles indisponibles », le reste du texte reste affiché ; le build ne dépend pas de la base.
- Textes en français, hiérarchie de titres, tableaux avec `<caption>`, mode sombre, lisible à 375 px sans défilement horizontal de la page.
- Aucune dépendance neuve ; `/api/stats`, `/api/live`, la carte et le tableau de bord inchangés, sauf un lien « Méthodologie » dans chacun.
- Périmètre : OUIGO Train Classique (numéros 4000 à 4999) exclus ; collecte commencée le 20 octobre 2026 ; seuil d'estompage de 30 trains (`SAMPLE_MIN`).

## Review Focus

- Postgres renvoie `numeric` en chaîne (`"46.60"`) : conversion en nombre, une valeur illisible fait échouer proprement (Task 1).
- Table vide ou une seule des trois en erreur : `502` complet, jamais une réponse partielle mise en cache (Tasks 1 et 2).
- Paramètre de requête sur `/api/rules` : `400` avant toute lecture de la base (Task 2).
- Lecture de la base impossible pendant la page : message dans la page, pas d'exception (Task 3, vérification manuelle).
- Les règles affichées dans la page sont celles de la base, pas des copies figées dans le code (Task 3).
- Aucune Release `events-*` : la page l'indique au lieu d'un lien mort (Task 3).

---

### Task 1: Lecture et mise en forme des règles

**Files:**
- Create: `web/lib/rules.ts`
- Test: `web/tests/rules.test.ts`

**Interfaces:**
- Consumes: `Deps` de `web/lib/handlers.ts` (`select`, `cached`, `now`), `toNum` de `web/lib/num.ts`.
- Produces:
  - `type Rules = { generated_at: string; compensation_scale: Scale[]; regularity_rule: RegularityRule[]; reference_prices: Price[] }` avec `Scale` et `Price` de `web/lib/stats.ts` et `type RegularityRule = { duration_from_s: number; max_delay_exclusive_s: number; source_url: string }`
  - `shapeRules(raw: { scale: unknown[]; regularity: unknown[]; prices: unknown[] }, now: Date): Rules` — convertit les nombres, trie, lève sur valeur non numérique
  - `loadRules(deps: Deps): Promise<Rules>` — trois `deps.select` en parallèle (colonnes : `brand,from_s,pct,source_url,source_as_of` ; `duration_from_s,max_delay_exclusive_s,source_url` ; `brand,price_eur_ht,seats,price_source,seats_source,as_of`), enveloppés dans `deps.cached(['rules', 'v1'], 3600, …)` ; lève si une lecture est en erreur ou ne renvoie pas un tableau

- [ ] **Step 1: Write the failing tests** dans `web/tests/rules.test.ts` (réutiliser `prices` et `scale` de `web/tests/fixtures.ts`) :
  - `shapeRules` : `price_eur_ht: '46.60'` devient `46.6`, `from_s: '1860'` devient `1860`, `generated_at` vaut `now.toISOString()` ; tri du barème `[OUIGO 3600, INOUI 7200, INOUI 1860]` → `[INOUI 1860, INOUI 7200, OUIGO 3600]` ; tri de `regularity_rule` par `duration_from_s` croissant ; tables vides → trois tableaux vides sans erreur ; `pct: 'abc'` → lève une erreur (message contenant `pct`).
  - `loadRules` : avec des `select` réussis, renvoie les trois tables mises en forme ; `deps.cached` appelé avec `(['rules', 'v1'], 3600, fn)` ; une table dont `select` renvoie `{ data: null, error: {…} }` → `loadRules` rejette (et le faux cache ne mémorise rien).
- [ ] **Step 2: Run** `cd web && npx vitest run tests/rules.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `shapeRules` et `loadRules` dans `web/lib/rules.ts` ; réutiliser `toNum` ; ne pas dupliquer les types `Scale` et `Price`.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npx vitest run` — Expected: tout passe.
- [ ] **Step 5: Commit** — `feat: lecture et mise en forme des règles (barèmes, régularité, prix)`

### Task 2: Route `/api/rules`

**Files:**
- Create: `web/app/api/rules/route.ts`
- Modify: `web/lib/handlers.ts` (+ `createRulesHandler`), `README.md` (section API)
- Test: `web/tests/handlers.test.ts`

**Interfaces:**
- Consumes: `loadRules`, `Rules` (Task 1), `json`, `guarded`, `Deps` (`web/lib/handlers.ts`).
- Produces: `createRulesHandler(deps: Deps): (req: Request) => Promise<Response>` ; route `GET /api/rules` (même `dynamic` et `preferredRegion` que `/api/live`).

- [ ] **Step 1: Write the failing tests** dans `web/tests/handlers.test.ts` (même style que les tests de `live`) : `?x=1` → `400` avec `cache-control: no-store`, sans appel à `select` ; succès → `200`, `cache-control` exact `public, s-maxage=3600, stale-while-revalidate=600`, corps avec les quatre clés et `reference_prices[0].price_eur_ht` numérique ; `cached` reçoit `['rules', 'v1']` et `3600` ; une erreur de lecture → `502` `no-store`, et un second appel après correction de la base réussit (rien de mémorisé).
- [ ] **Step 2: Run** `cd web && npx vitest run tests/handlers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `createRulesHandler` (refus de tout paramètre avant la lecture, `guarded`, `json(await loadRules(deps), 200, RULES_CACHE)`) et la route ; section « `GET /api/rules` » du README (champs, cache, usage).
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe, `/api/rules` dans la sortie de build.
- [ ] **Step 5: Commit** — `feat: route /api/rules`

### Task 3: Page `/methodologie` et navigation

**Files:**
- Create: `web/app/methodologie/page.tsx`, `web/app/methodologie/methodologie.css`
- Modify: `web/app/layout.tsx` (import du CSS), `web/app/carte-view.tsx` et `web/app/tableau/tableau-view.tsx` (lien « Méthodologie »), `README.md`

**Interfaces:**
- Consumes: `loadRules`, `Rules` (Task 1), `supabaseDeps` de `web/lib/supabase.ts`.
- Produces: page `/methodologie` (composant serveur, `export const revalidate = 3600`).

- [ ] **Step 1: Implement la page.** Elle appelle `loadRules(supabaseDeps)` dans un `try/catch` : en cas d'échec, les sections qui dépendent des règles affichent « Règles indisponibles pour le moment, réessayez plus tard. » et le reste du texte reste rendu. Sections et titres : Sources et licence ; Périmètre ; Définitions (prévu, observé, jamais observé, retiré tard, annulé, sans terminus, ayant circulé ; régularité officielle avec le tableau lu dans `regularity_rule` — durée prévue à partir de X, retard strictement inférieur à Y — ; mesure brute et ses huit tranches) ; Indemnités théoriques (un tableau par marque lu dans `compensation_scale` avec source et date, prix de référence HT et places lus dans `reference_prices` avec leurs sources, occupation 0,75 signalée « hypothèse non sourcée », formule du coût) ; Positions sur la carte (estimées, retard constant, tracé des voies sinon ligne droite, donnée périmée après 10 minutes) ; Limites connues (collecte depuis le 20 octobre 2026, retards par pas de 5 minutes et ses conséquences, trains absents du plan du jour, échantillons de moins de 30 trains estompés, causes pas encore agrégées, tracés absents pour quelques gares) ; Téléchargements (lien `/api/rules`, lien vers `https://github.com/n3ographic/sncf-tracking/releases` avec « le premier export du journal `events-AAAA-MM` est prévu début novembre 2026 », lien vers le dépôt). Liens de retour vers la carte et le tableau de bord ; mention « Observatoire indépendant, non affilié à SNCF ni à OUIGO ».
- [ ] **Step 2: Implement** le CSS (mêmes jetons de couleur que `tableau.css`, mode sombre, tableaux défilant dans leur conteneur), l'import dans `layout.tsx`, les liens « Méthodologie » dans `carte-view.tsx` (barre) et `tableau-view.tsx` (en-tête), une courte section « Méthodologie » dans le README.
- [ ] **Step 3: Verify build** `cd web && npx tsc --noEmit && npm run build && npx vitest run` — Expected: tout passe, `/methodologie` listée ; le build ne plante pas même sans variables d'environnement Supabase (vérifier avec `env -u SUPABASE_URL -u SUPABASE_ANON_KEY npm run build` ou en renommant temporairement `web/.env.local`).
- [ ] **Step 4: Vérifier à la main** (prévisualisation, navigateur intégré) : la page se lit de haut en bas ; les barèmes et seuils affichés correspondent à `/api/rules` ; en bloquant la base (variables absentes en dev), le message « Règles indisponibles » apparaît sans erreur ; bureau, mobile 375 px sans défilement horizontal de la page, mode sombre ; liens carte ⇄ tableau de bord ⇄ méthodologie. Consigner dans `docs/findings/2026-10-21-methodologie.md`.
- [ ] **Step 5: Commit** — `feat: page méthodologie`

### Task 4: Mise en ligne

**Files:**
- Modify: `docs/findings/2026-10-21-methodologie.md`

**Interfaces:**
- Consumes: Tasks 1 à 3.
- Produces: `/methodologie` et `/api/rules` en production sur `https://sncf-tracking.vercel.app`.

**Arrêt obligatoire : pousser et déployer publient. Demander l'accord de l'auteur avant la Step 1.**

- [ ] **Step 1: Après accord**, fusion rapide de la branche dans `main`, `git push origin main`, puis `vercel deploy --prod --yes` depuis la racine du dépôt.
- [ ] **Step 2: Vérifier en production** : `curl -s -o /dev/null -w '%{http_code}' https://sncf-tracking.vercel.app/methodologie` renvoie 200 ; `curl -s https://sncf-tracking.vercel.app/api/rules` renvoie les quatre clés avec des nombres ; `curl -s -o /dev/null -w '%{http_code}' 'https://sncf-tracking.vercel.app/api/rules?x=1'` renvoie 400 ; page vue dans le navigateur sans erreur console ; consigner dans les findings, commit et push (après accord) — `docs: vérification de la méthodologie en production`.

---

**Plan suivant** : 4b (compteur cumulé, table de cumuls journaliers et `pg_cron`). Plans à part : export mensuel des circulations, agrégation des causes de retard.
