-- Règles de cause complétées (textes restés en « autre » jusqu'au 27/10/2026) et catégorie « degradation »
-- (vol, vandalisme, malveillance). Données seules : relancer snapshot_day sur les jours concernés pour daily_stats.

insert into public.cause_rules (priority, category, pattern, note) values
  (45, 'degradation', '\m(vandalisme|malveillance|dégradations?)\M|vols? de (câbles?|cuivre)', 'après météo : « dégradation des conditions météo » reste météo');

update public.cause_rules set pattern = pattern || '|mission précédente|train précédent|attente de personnel' where category = 'enchainement';
update public.cause_rules set pattern = pattern || '|\mmanifestants?\M' where category = 'voyageurs_surete';
update public.cause_rules set pattern = pattern || '|système informatique' where category = 'infrastructure';
update public.cause_rules set pattern = pattern || '|composition|défaut a été détecté sur votre train|vérification technique' where category = 'materiel';
update public.cause_rules set pattern = pattern || '|conditions de départ non réunies' where category = 'exploitation';
