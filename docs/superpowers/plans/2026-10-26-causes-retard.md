# Classification des causes de retard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classer les causes déclarées des retards et afficher, par période, trains, retard moyen et indemnités par catégorie, dans un panneau à côté de MARQUE × AXE.

**Architecture:** Une table de règles et une fonction SQL `cause_category` ; `stats_period` produit trois nouvelles familles de mesures rangées dans `daily_stats` ; `shapeStats` en tire `cause_breakdown` ; un panneau `CausesPanel` l'affiche.

**Tech Stack:** PostgreSQL (Supabase, harnais PGlite pour les tests), Next.js / TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-causes-retard-design.md`

## Global Constraints

- Branche `causes` (contient la spec). Pas de push ; fusion `--ff-only` après accord. La migration ne s'applique en production qu'après accord explicite, puis le code, puis la vérification.
- Migration additive ; seule `public.stats_period` est remplacée (`create or replace`, mêmes colonnes de sortie).
- Codes de catégorie exacts : `enchainement`, `meteo`, `obstacle`, `voyageurs_surete`, `infrastructure`, `materiel`, `regulation`, `information`, `plusieurs`, `exploitation`, `autre`, `sans_cause`.
- Mesures comptées sur les trains circulés, non aberrants (retard < 43 200 s), retard au terminus ≥ 300 s.
- Coût = Σ (pourcentage / 100 × prix de la marque × places × 0,75), calculé par marque avant somme.
- Clé de cache des stats : `['stats', 'v3', from, to]`.
- Textes affichés en majuscules, français accentué ; mention de pied exacte : `CAUSE DÉCLARÉE PAR SNCF · CLASSÉE PAR NOS RÈGLES · TRAINS ≥ 5′`.
- Tests : racine `npx vitest run` (SQL) ; web `cd web && npx vitest run && npx tsc --noEmit`.

## Review Focus

- Un texte où un mot-clé apparaît dans un autre mot (« vent » dans « intervention ») ne doit pas changer de catégorie (test tâche 1).
- Un texte dont la phrase « Cause : » est suivie de phrases d'habillage citant des voyageurs doit être classé sur la phrase « Cause : » (test tâche 1).
- Une ancienne réponse en cache sans les mesures `cause*` : `cause_breakdown` vaut `[]`, sans erreur (test tâche 2).
- `/api/cumul` avec les nouvelles mesures présentes : totaux inchangés (test tâche 2).
- Période sans train en retard : le panneau affiche `AUCUN RETARD SUR CETTE PÉRIODE` (vérifié tâche 4).

---

### Task 1: Règles, fonction SQL et mesures

**Files:**
- Create: `supabase/migrations/20261027000001_cause_categories.sql`
- Modify: `tests/sql/harness.ts` (ajouter le fichier à `MIGRATIONS_UNDER_TEST`, en dernier)
- Create: `tests/cause-category.test.ts`
- Modify: `tests/measures.test.ts` (test `métriques INOUI SUD_EST`)

**Interfaces:**
- Produces : table `public.cause_rules(priority int primary key, category text not null, pattern text not null, note text)` ; fonction `public.cause_category(p_cause text) returns text` ; mesures `cause:<code>`, `cause_delay_s:<code>`, `cause_comp:<code>` dans `stats_period` et donc `daily_stats`.

- [ ] **Step 1: Écrire les tests qui échouent** dans `tests/cause-category.test.ts` (même mise en place que `tests/range-measures.test.ts` : `makeDb`, `resetData`, `seedTrip`).
  - `cause_category` : un `test.each` sur ces textes (réels) → code attendu :
    - `null` → `sans_cause`
    - `Cause : le conducteur a dû ralentir pour garantir la distance de sécurité entre les trains à MÂCON.` → `regulation`
    - `Cause : le matériel utilisé pour assurer votre train a été retardé sur son précédent trajet à LILLE FLANDRES en raison du heurt d'un animal` → `enchainement`
    - `Cause : votre train a fait l'objet d'une intervention de maintenance à NÎMES CENTRE. Pour mieux comprendre…` → `materiel` (piège « vent »)
    - `Les conditions climatiques actuelles nécessitent l'application de mesures de sécurité sur votre itinéraire. Des ralentissements sont imposés…` → `meteo`
    - `Cause : défaut d'alimentation électrique entre LABOUHEYRE et MORCENX. Les équipes du gestionnaire du réseau ferré sont en cours d'intervention. … Pour les voyageurs concernés par la suppression…` → `infrastructure` (piège habillage)
    - `Votre retard est dû à deux incidents distincts : Les conditions climatiques actuelles …` → `plusieurs`
    - `Cause : un obstacle a été signalé sur les voies à GRAFFENSTADEN.` → `obstacle`
    - `Cause : opération de sûreté à PERPIGNAN.` → `voyageurs_surete`
    - `Cause : feuilles sur les voies entre VALENCIENNES et DOUAI.` → `meteo`
    - `Cause : votre train fait l'objet de vérifications techniques à MODANE.` → `materiel`
    - `Des travaux de renouvellement des appareils de voie sont en cours sur la ligne à grande vitesse à Roeux` → `infrastructure`
    - `Cause : emprunt d'un autre itinéraire avec modification de la desserte du train à HYÈRES.` → `information`
    - `Retard affectant votre train. En raison d'un incident d’exploitation survenu au cours du trajet, votre train circule actuellement avec un retard.` → `exploitation`
    - `Cause : orage violent à RENNES.` → `meteo`
    - `Gare de Tourcoing : texte sans rapport connu` → `autre`
  - `stats_period : mesures par cause, trains ≥ 300 s seulement` : trains INOUI SUD_EST du 2026-11-01 (arrivée `2026-11-01T20:00:00Z`, `NOW = 2026-11-02T12:00:00Z`) — A 600 s cause météo (`Cause : orage violent à RENNES.`), B 1 860 s même cause, C 7 200 s sans cause, D 299 s cause météo (sous le seuil), E supprimé cause météo, F 43 200 s cause météo (aberrant). Attendu : `'cause:meteo': 2, 'cause_delay_s:meteo': 2460, 'cause_comp:meteo': 25, 'cause:sans_cause': 1, 'cause_delay_s:sans_cause': 7200, 'cause_comp:sans_cause': 50`, et aucune autre clé commençant par `cause`.
- [ ] **Step 2: Lancer et voir échouer** : `npx vitest run tests/cause-category.test.ts` ; attendu : FAIL, `function public.cause_category(unknown) does not exist`.
- [ ] **Step 3: Écrire la migration.**
  - Table `cause_rules` : RLS activée, `revoke insert, update, delete, truncate … from anon, authenticated`, politique `anon_read` en lecture (comme `daily_stats`).
  - Règles (motifs appliqués avec `~*` ; `plusieurs` sur le texte entier, les autres sur le texte classé) :

    | priority | category | pattern |
    |---|---|---|
    | 10 | plusieurs | `deux incidents distincts` |
    | 20 | enchainement | `précédent trajet\|précédente mission\|retardé sur sa précédente\|retardé à \|se raccorder\|correspondance\|resté à quai plus longtemps\|agent essentiel\|membre de l.équipage` |
    | 30 | meteo | `\m(tempête\|météo\w*\|climatiques?\|intempéries\|orages?\|vents?\|précipitations\|inondations?\|crues?\|neige\|verglas\|canicule\|arbres?\|feuilles)\M\|chute d.arbre` |
    | 40 | obstacle | `\m(heurté\|heurt\|animal\|animaux\|sanglier\|obstacle)\M\|choc anormal` |
    | 50 | voyageurs_surete | `\m(voyageurs?\|malaise\|personnes?\|sûreté\|frontière\|autorités\|colis\|bagage\|client\|manifestations?)\M\|état de santé\|signal d.alarme\|périmètre de sécurité\|conditions de sécurité` |
    | 60 | infrastructure | `\m(travaux\|aiguillage\|caténaire\|signalisation\|voie)\M\|alimentation électrique\|défaut affectant la voie\|passage à niveau\|appareils de voie\|gestionnaire du réseau\|dysfonctionnement électrique\|réseau ferré` |
    | 70 | materiel | `\m(matériel\|maintenance\|rame\|réparations?\|dépannage)\M\|panne de votre train\|formation du train\|panne matériel\|vérifications techniques\|dysfonctionnement sur votre train\|lieu de garage\|opérations de départ` |
    | 80 | regulation | `\m(ralentir\|ralentissements?)\M\|densité du trafic\|train circulant devant\|distance de sécurité\|panne d.un (autre )?train\|régulation\|roule actuellement doublé` |
    | 90 | information | `itinéraire\|ne desservi\|fin des perturbations\|exceptionnellement\|équipement de vente` |
    | 100 | exploitation | `incident d.exploitation` |

    (Les `\|` du tableau sont des `|` dans le SQL.)
  - `cause_category(p_cause text) returns text` (`language sql stable security invoker set search_path = ''`) : `sans_cause` si `null` ; texte classé = `lower(coalesce(substring(p_cause from '(?i)cause ?: ?([^.]*)'), left(p_cause, 200)))` ; première règle par `priority` qui correspond (`plusieurs` testée sur `lower(p_cause)`) ; sinon `autre`.
  - `create or replace function public.stats_period(...)` : reprendre le corps de `20261026000001_aberrant_and_range.sql` à l'identique et ajouter une branche `union all` qui, sur `base` filtré `circulated and not aberrant and terminus_delay_s >= 300`, groupe par `brand, axis, public.cause_category(cause)` et émet les trois mesures (`count(*)`, `sum(terminus_delay_s)`, `sum(comp_pct)`). Si `base` n'expose pas déjà `cause`, l'ajouter à sa liste de colonnes.
  - En fin de migration, recalculer chaque jour du `2026-10-20` à la veille (Paris) avec `public.snapshot_day(d)`, comme la boucle de la migration du 26 octobre.
- [ ] **Step 4: Mettre à jour `métriques INOUI SUD_EST`** (`tests/measures.test.ts`) : ajouter `'cause:sans_cause': 4, 'cause_delay_s:sans_cause': 8940, 'cause_comp:sans_cause': 50` (trains B, C, D, G du jeu : 300 + 540 + 900 + 7 200 s).
- [ ] **Step 5: Lancer** `npx vitest run` à la racine ; attendu : tout passe (132 + nouveaux).
- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261027000001_cause_categories.sql tests/sql/harness.ts tests/cause-category.test.ts tests/measures.test.ts
git commit -m "feat(sql): règles de classement des causes, cause_category et mesures par cause"
```

---

### Task 2: `cause_breakdown` dans `/api/stats`

**Files:**
- Create: `web/lib/causes.ts`
- Modify: `web/lib/stats.ts` (`StatsPayload`, `shapeStats`)
- Modify: `web/lib/handlers.ts` (clé `['stats', 'v3', …]`)
- Test: `web/tests/stats.test.ts`, `web/tests/handlers.test.ts`, `web/tests/cumul.test.ts`

**Interfaces:**
- Consumes : mesures `cause:<code>`, `cause_delay_s:<code>`, `cause_comp:<code>` (tâche 1).
- Produces :
  - `web/lib/causes.ts` : `export const CAUSE_LABELS: Record<string, { short: string; long: string }>` pour les 12 codes (court : `ENCHAÎNEMENT`, `MÉTÉO`, `OBSTACLE / ANIMAL`, `VOYAGEURS / SÛRETÉ`, `INFRASTRUCTURE`, `MATÉRIEL`, `RÉGULATION`, `INFO SANS CAUSE`, `PLUSIEURS CAUSES`, `EXPLOITATION`, `AUTRE`, `SANS CAUSE` ; long : libellés du tableau de la spec).
  - `web/lib/stats.ts` : `export type CauseRow = { category: string; trains: number; avg_delay_min: number; cost_eur_ht: number }` et `StatsPayload.cause_breakdown: CauseRow[]`.

- [ ] **Step 1: Tests qui échouent.**
  - `stats.test.ts` › `cause_breakdown : coût par marque, tri par coût puis trains, catégories vides omises` : lignes INOUI (prix 46,6 €, 556 places) `cause:meteo` 2, `cause_delay_s:meteo` 2460, `cause_comp:meteo` 25 ; OUIGO (34,2 €, 634 places) `cause:meteo` 1, `cause_delay_s:meteo` 3600, `cause_comp:meteo` 25 ; INOUI `cause:regulation` 3, `cause_delay_s:regulation` 1800, `cause_comp:regulation` 0. Attendu : `[{ category: 'meteo', trains: 3, avg_delay_min: 34, cost_eur_ht: round(0.25×46.6×556×0.75 + 0.25×34.2×634×0.75, 2) }, { category: 'regulation', trains: 3, avg_delay_min: 10, cost_eur_ht: 0 }]` ; `avg_delay_min` = `Math.round(somme / trains / 60)`.
  - `stats.test.ts` › `sans mesures de cause (ancienne réponse) : cause_breakdown vide` → `[]`.
  - `handlers.test.ts` : la clé attendue devient `stats|v3|2026-10-14|2026-10-20`.
  - `cumul.test.ts` › `mesures de cause présentes : totaux inchangés` : ajouter des lignes `cause:meteo` et `cause_comp:meteo` à un jeu existant et vérifier le même résultat qu'avant.
- [ ] **Step 2: Lancer et voir échouer** : `cd web && npx vitest run` ; attendu : FAIL sur `cause_breakdown` undefined et sur la clé `v2`.
- [ ] **Step 3: Implémenter** : dans la boucle de `shapeStats`, les métriques de forme `cause:…`, `cause_delay_s:…`, `cause_comp:…` alimentent un cumul par catégorie (coût via le prix de `row.brand`, même `perPct` que la fourchette) au lieu d'être ignorées ; trier, arrondir le coût à 2 décimales, omettre `trains === 0`. Clé `v3` dans `handlers.ts` (mettre à jour le commentaire). `cumul.ts` ne doit pas changer (il ignore déjà les métriques hors `COUNTS`) ; ne le modifier que si le test échoue.
- [ ] **Step 4: Vérifier** : `cd web && npx vitest run && npx tsc --noEmit` ; attendu : propre.
- [ ] **Step 5: Commit**

```bash
git add web/lib/causes.ts web/lib/stats.ts web/lib/handlers.ts web/tests
git commit -m "feat(api): répartition des retards par cause dans /api/stats ; clé de cache v3"
```

---

### Task 3: Panneau CAUSES à côté de MARQUE × AXE

**Files:**
- Create: `web/app/terminal/causes-panel.tsx`
- Modify: `web/app/terminal/terminal-view.tsx` (bande du bas)
- Modify: `web/app/terminal/terminal.css`

**Interfaces:**
- Consumes : `stats.cause_breakdown`, `CAUSE_LABELS`, `charBar`, `periodLabel`, et les mêmes props d'état que `GroupsPanel` (`stats`, `failed`, `loading`, `period`).
- Produces : `export default function CausesPanel({ stats, failed, loading, period })`.

- [ ] **Step 1: Bande du bas** : dans `terminal-view.tsx`, envelopper `GroupsPanel` et `CausesPanel` dans `<div className="term-bottom">`. CSS : `.term-bottom { flex: 38 1 0; min-height: 150px; display: flex; gap: 6px; }` ; `.groups` perd son `flex: 38 1 0` au profit de `flex: 1 1 0; min-width: 0` ; `.causes { flex: 0 0 420px; display: flex; flex-direction: column; font-size: 12px; }` avec une zone défilante comme `.groups-scroll`. Mobile : ajouter `.term-bottom` à la règle `display: contents` et donner `.causes` le même `order` que `.groups`.
- [ ] **Step 2: Panneau** : titre `Causes {periodLabel(period)}` ; états comme `GroupsPanel` (`INDISPONIBLE`, `…`, `AUCUN RETARD SUR CETTE PÉRIODE`, classe `term-stale` pendant le chargement) ; une ligne par catégorie : libellé court (infobulle = libellé long), barre `charBar(cost / maxCost × 100, 10)` (ou `trains / maxTrains` si tous les coûts sont nuls), trains, `{avg_delay_min}′`, `{cost} €` (`toLocaleString('fr-FR')`) ; pied : la mention exacte des Global Constraints.
- [ ] **Step 3: Vérifier** : `cd web && npx tsc --noEmit && npx vitest run` ; attendu : propre.
- [ ] **Step 4: Commit**

```bash
git add web/app/terminal
git commit -m "feat(web): panneau CAUSES à côté de MARQUE × AXE"
```

---

### Task 4: Méthodologie et vérification à l'écran

**Files:**
- Modify: `web/app/methodologie/page.tsx` (nouvelle `<h2>Causes de retard</h2>` entre « Indemnités théoriques » et « Positions sur la carte »)
- Modify: `README.md` (une ligne dans la description des mesures)

- [ ] **Step 1: Section méthodologie** : la liste des 12 catégories (libellés longs de `CAUSE_LABELS`), le mode de classement (phrase après « Cause : », première règle par priorité, table `cause_rules` publique, lien vers le fichier de migration sur GitHub), le périmètre (trains ≥ 5 min, hors supprimés et aberrants) et les quatre limites de la spec.
- [ ] **Step 2: Vérifier** : `cd web && npx tsc --noEmit && npx vitest run` ; racine `npx vitest run`.
- [ ] **Step 3: Écran local** : la base locale n'a pas la migration ; vérifier contre la production seulement après la tâche 5. En attendant, vérifier l'état vide et la mise en page avec `preview_start web` (réponse sans `cause_breakdown` en cache : panneau `AUCUN RETARD…` ou vide sans erreur ; vider `web/.next/cache/fetch-cache` avant).
- [ ] **Step 4: Commit**

```bash
git add web/app/methodologie/page.tsx README.md
git commit -m "docs: causes de retard dans la méthodologie"
```

---

### Task 5: Mise en production (après accord explicite à chaque étape)

- [ ] **Step 1: Migration** : appliquer `20261027000001_cause_categories.sql` avec l'outil `apply_migration` du MCP Supabase, puis contrôler : `select category, count(*) from (select public.cause_category(cause) category from circulations where not cancelled and terminus_delay_s between 300 and 43199) x group by 1` (répartition proche du test du 26 octobre, `autre` ≤ 1 %), et `select count(*) from daily_stats where metric like 'cause:%'` > 0.
- [ ] **Step 2: Code** : fusion `--ff-only` dans `main` et push (déploiement Vercel).
- [ ] **Step 3: Vérification** : `/api/stats?period=7d` renvoie `cause_breakdown` (premier appel `x-vercel-cache: MISS`) ; écran à 2000 × 1080, 1600 × 900 et mobile, textes lus avec `javascript_tool`.
