# Classification des causes de retard

Date : 2026-10-26. Statut : design validé en conversation, à relire avant le plan.

## But

Montrer, pour la période choisie (7J / 14J / 31J / mois), quelles causes déclarées font les retards : nombre de trains, retard moyen et indemnités théoriques par type de cause. Les règles de classement sont publiques et versionnées ; les modifier recalcule tout l'historique.

## Constat (test en lecture seule sur les données du 20 au 26 octobre 2026)

- `circulations.cause` contient le dernier texte d'alerte connu du train (écrasé à chaque collecte). 68 % des trains en retard d'au moins 5 min en ont un.
- 744 textes distincts, très répétitifs : un jeu de règles par expressions régulières classe 97 % des textes ; les 58 cas restants sont rattachables par ajout de mots-clés.
- Pièges vérifiés : un motif sans limite de mot (« vent » dans « intervention ») classe à tort ; les phrases d'habillage en fin de message (« pour les voyageurs concernés… ») faussent le classement si on lit le texte entier.

## Catégories

Codes stables (utilisés dans les mesures et l'API) et libellés affichés :

| Code | Libellé |
|---|---|
| `enchainement` | Enchaînement (retard venu d'un trajet précédent, d'un équipage ou d'une correspondance) |
| `meteo` | Météo et végétation |
| `obstacle` | Obstacle, animal, choc |
| `voyageurs_surete` | Voyageurs et sûreté |
| `infrastructure` | Infrastructure et travaux |
| `materiel` | Matériel et préparation du train |
| `regulation` | Régulation du trafic |
| `information` | Information sans cause (itinéraire modifié, desserte, fin de perturbation) |
| `plusieurs` | Plusieurs causes |
| `exploitation` | Incident d'exploitation non précisé |
| `autre` | Autre |
| `sans_cause` | Sans cause déclarée |

## Base de données (migration additive)

- **Table `cause_rules`** : `priority int primary key`, `category text not null`, `pattern text not null` (expression régulière PostgreSQL, insensible à la casse, avec limites de mots `\m…\M` quand le motif est un mot), `note text`. Lecture publique, aucune écriture pour `anon` et `authenticated` (même régime que `daily_stats`).
- Contenu initial : les règles du test du 26 octobre, dans cet ordre de priorité : `plusieurs` (« deux incidents distincts », testé sur le texte entier), `enchainement`, `meteo`, `obstacle`, `voyageurs_surete`, `infrastructure`, `materiel`, `regulation`, `information`, `exploitation`. Elles sont complétées pour couvrir les 58 cas « autre » relevés (feuilles sur les voies → `meteo` ; animaux repérés → `obstacle` ; périmètre de sécurité, comportement d'un client → `voyageurs_surete` ; vérifications techniques, dépannage, réparations, acheminement depuis le garage, opérations de départ → `materiel`).
- **Fonction `cause_category(p_cause text) returns text`** (`stable`, `security invoker`, `search_path = ''`) :
  - `null` → `sans_cause` ;
  - texte classé : la phrase qui suit « Cause : » (jusqu'au premier point) si elle existe, sinon les 200 premiers caractères ;
  - la règle `plusieurs` s'applique au texte entier ; les autres au texte classé ;
  - première règle qui correspond, par priorité croissante ; aucune → `autre`.
- **`stats_period`** (seule fonction remplacée) ajoute trois familles de mesures, sur les trains circulés, non aberrants, en retard d'au moins 300 s au terminus :
  - `cause:<code>` : nombre de trains ;
  - `cause_delay_s:<code>` : somme des retards au terminus (s) ;
  - `cause_comp:<code>` : somme des pourcentages d'indemnité (même base que `comp_pct_sum`).
- Recalcul : `snapshot_day` pour chaque jour depuis le 2026-10-20, comme lors de la migration du 26 octobre.
- Séquence de mise en production (règle du projet) : migration, puis code, puis vérification, chacune après accord explicite.

## API

- `/api/stats` ajoute `cause_breakdown: { category: string; trains: number; avg_delay_min: number; cost_eur_ht: number }[]`, sur l'ensemble des groupes de la période, trié par `cost_eur_ht` décroissant puis `trains`. `cost_eur_ht` suit la même formule que le coût existant (pourcentage × prix de la marque × places × occupation 0,75), donc calculé par marque avant somme.
- Une catégorie sans train est omise.
- Clé de cache des statistiques : `['stats', 'v3', from, to]` (la forme de la réponse change).
- `/api/cumul` ne change pas de forme ; il doit ignorer les nouvelles mesures sans erreur.

## Écran

- La bande sous la carte devient deux panneaux côte à côte, tous deux visibles : `MARQUE × AXE` (inchangé, à gauche, largeur restante) et `CAUSES {période}` (à droite, environ 420 px).
- Panneau `CAUSES` : une ligne par catégorie (ordre de l'API) avec libellé court, barre proportionnelle aux indemnités (en caractères, comme les autres barres), nombre de trains, retard moyen en minutes et indemnités en € HT. Mention en pied : « CAUSE DÉCLARÉE PAR SNCF · CLASSÉE PAR NOS RÈGLES · TRAINS ≥ 5′ ».
- États : `INDISPONIBLE` si les stats échouent, `…` au chargement, `AUCUN RETARD SUR CETTE PÉRIODE` si la liste est vide ; `term-stale` pendant le chargement d'une autre période.
- Mobile : le panneau `CAUSES` vient après `MARQUE × AXE`.

## Méthodologie

Une section « Causes de retard » : définition des catégories, lien vers la table `cause_rules` (et le fichier de migration), et limites :
- cause déclarée par SNCF, pas vérifiée ;
- seule la dernière cause connue du train est gardée ;
- `enchainement` masque la cause d'origine du retard précédent ;
- les causes n'interviennent pas dans le calcul des indemnités.

## Hors périmètre

- Catégorie dans la fiche du train (exigerait de modifier `live_trains` et d'alourdir `/api/live`).
- Historique des changements de cause d'un train.
- Effet d'une cause (grève, événement exceptionnel) sur le droit à indemnisation.

## Tests

- SQL (harnais PGlite, migration ajoutée à `MIGRATIONS_UNDER_TEST`) : `cause_category` sur au moins quinze textes réels, dont « intervention de maintenance » (`materiel`, pas `meteo`), un texte avec phrase d'habillage contenant « voyageurs » (classé sur la phrase « Cause : »), « deux incidents distincts » (`plusieurs`), `null` (`sans_cause`), un texte sans règle (`autre`) ; `stats_period` produit les trois familles de mesures et ignore les trains à l'heure, supprimés et aberrants. Le test existant qui énumère toutes les mesures est mis à jour.
- TypeScript : la mise en forme de `cause_breakdown` (coût par marque, tri, omission des catégories vides) ; `/api/cumul` inchangé avec les nouvelles mesures présentes.
- Écran : vérification locale à 2000 × 1080, 1600 × 900 et mobile.
