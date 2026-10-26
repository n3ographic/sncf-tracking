# Tracés : complément Train Nomade (2026-10-26)

Source : jeu « Tracés ferroviaires entre deux arrêts » de [Train Nomade](https://trainnomade.fr/donnees/) (3 218 tronçons OpenStreetMap, indexés par code UIC, ODbL, calculé le 2026-10-17). Auteur du site non identifié.

## Recoupement avec nos paires (307 paires d'arrêts consécutifs distinctes, par UIC)

| | Paires |
|---|---|
| Tracées chez nous et chez eux | 240 |
| Chez nous seulement | 27 |
| Chez eux seulement | 36 |
| Chez personne | 4 (Metz–Luxembourg, Milan–Turin, La Teste–Biganos, Ringsheim–Offenburg) |

Sur les 240 paires communes, la médiane du rapport de longueurs (nous / eux) est de 0,999 ; 227 paires sont à moins de 5 % d'écart, 231 à moins de 10 %. Les 9 écarts supérieurs à 10 % vont tous dans le même sens (nos tracés sont plus longs) : Lyon Perrache–Valence TGV Rhône-Alpes Sud (+12 %), Dijon–Paris Gare de Lyon (+13 %), Aéroport Charles de Gaulle 2 TGV vers Tourcoing, Lille Flandres et Lille Europe (+17 à +18 %), Bordeaux–Angoulême (+17 %), Paris Gare de Lyon–Montbard (+18 %), Champagne-Ardenne TGV–CDG 2 (+31 %), TGV Haute Picardie–CDG 2 (+35 %). Non tranché : on ignore lequel des deux tracés suit la voie réellement empruntée par les TGV ; à regarder sur une carte avant de toucher à nos tracés.

## Changement

`scripts/build-traces.ts` demande un tronçon Train Nomade seulement lorsque notre routage sur les formes SNCF Réseau échoue ; un tracé SNCF Réseau n'est jamais remplacé. Garde-fous (`scripts/lib/troncons-tn.ts`, testés) : extrémités à 1,5 km au plus des arrêts, longueur d'au plus 2 fois le vol d'oiseau. Le fichier téléchargé est gardé dans `tmp/traces-train-nomade.geojson` (git-ignoré), comme celui de SNCF Réseau.

Résultat (régénération du 2026-10-26) : 309 clés (273 de l'ancien fichier, dont 6 conservées ; 30 de Train Nomade ; 6 nouvelles paires de l'horaire de la semaine tracées par SNCF Réseau). Aucune clé supprimée, aucun tracé existant modifié (contrôle clé par clé contre le fichier précédent et contre une régénération de `main` le même jour). Couverture des paires d'arrêts : 376 / 380 (98,9 %) contre 341 / 380 (89,7 %). Rapport tracé / vol d'oiseau : médian 1,119, maximal 1,718 (Lyon Perrache–Part-Dieu, 5 km pour 3 km de vol d'oiseau).

## Conservation des anciennes paires

Le fichier précédent perdait 6 paires à la régénération : Chambéry–Challes-les-Eaux–Albertville–Moûtiers–Aime–Landry–Bourg-Saint-Maurice (trains de ski de la Tarentaise) et Aéroport Charles de Gaulle 2 TGV–Arras. L'horaire en base ne couvre que 4 jours (25 au 28 octobre aujourd'hui) : une paire de week-end ou de saison en est absente certains jours et retomberait en ligne droite. Le script garde désormais les clés du fichier précédent qui ne figurent pas dans l'horaire du jour.

## Taille

Le fichier passe de 476 à 532 Ko (budget du plan 3b : 500 Ko avant compression), soit 125 Ko compressé (110 Ko avant). Dépassement accepté : le relever coûterait de changer la tolérance de simplification de nos tracés existants, ce que la demande excluait.

## Attribution

README et page de méthodologie : « Train Nomade, d'après © contributeurs OpenStreetMap (ODbL) et les horaires GTFS de SNCF Voyageurs (ODbL) » ; champ `source` du fichier. Le fichier reste une base dérivée sous ODbL.

## Limites

- Les 30 tronçons ajoutés ont été regardés sur une carte (6 zones : Barcelone–Perpignan, Offenburg–Fribourg, Turin–Modane, interconnexion francilienne, Lille–Bruxelles, vue d'ensemble) ; aucun n'a été comparé à une trace réelle.
- Dépendance à un fichier tiers : il n'est lu qu'à la régénération (hors ligne), jamais par le site en production.
- Le jeu est recalculé chaque mois par Train Nomade ; relancer `npm run build:traces` après suppression de `tmp/traces-train-nomade.geojson` pour en reprendre une version à jour.
