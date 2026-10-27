// Libellés des catégories de cause (codes de la table cause_rules et de cause_category en base).
export const CAUSE_LABELS: Record<string, { short: string; long: string }> = {
  enchainement: { short: 'ENCHAÎNEMENT', long: 'Enchaînement (retard venu d’un trajet précédent, d’un équipage ou d’une correspondance)' },
  meteo: { short: 'MÉTÉO', long: 'Météo et végétation' },
  obstacle: { short: 'OBSTACLE / ANIMAL', long: 'Obstacle, animal, choc' },
  malveillance: { short: 'MALVEILLANCE', long: 'Malveillance (vol de câbles, vandalisme, signal d’alarme tiré abusivement)' },
  voyageurs_surete: { short: 'VOYAGEURS / SÛRETÉ', long: 'Voyageurs et sûreté' },
  infrastructure: { short: 'INFRASTRUCTURE', long: 'Infrastructure et travaux' },
  materiel: { short: 'MATÉRIEL', long: 'Matériel et préparation du train' },
  regulation: { short: 'RÉGULATION', long: 'Régulation du trafic' },
  information: { short: 'INFO SANS CAUSE', long: 'Information sans cause (itinéraire modifié, desserte, fin de perturbation)' },
  plusieurs: { short: 'PLUSIEURS CAUSES', long: 'Plusieurs causes' },
  exploitation: { short: 'EXPLOITATION', long: 'Incident d’exploitation non précisé' },
  autre: { short: 'AUTRE', long: 'Autre' },
  sans_cause: { short: 'SANS CAUSE', long: 'Sans cause déclarée' },
};
