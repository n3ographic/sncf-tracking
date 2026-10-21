-- Règles de mesure publiques et sourcées (plan 2) : barèmes d'indemnisation, régularité officielle, prix de référence.
-- Migration additive : rien de ce que lit ou écrit le collecteur n'est modifié.

-- Retard au terminus en secondes : pct s'applique dès from_s (inclus) jusqu'au palier suivant.
create table public.compensation_scale (
  brand text not null check (brand in ('INOUI', 'OUIGO')),
  from_s int not null check (from_s > 0),
  pct int not null check (pct between 1 and 100),
  source_url text not null,
  source_as_of date not null,
  note text,
  primary key (brand, from_s)
);

-- Durée prévue en secondes : à l'heure si retard au terminus < max_delay_exclusive_s.
create table public.regularity_rule (
  duration_from_s int primary key check (duration_from_s >= 0),
  max_delay_exclusive_s int not null check (max_delay_exclusive_s > 0),
  source_url text not null
);

create table public.reference_prices (
  brand text primary key check (brand in ('INOUI', 'OUIGO')),
  price_eur_ht numeric(6, 2) not null check (price_eur_ht > 0),
  seats int not null check (seats > 0),
  price_source text not null,
  seats_source text not null,
  as_of date not null
);

insert into public.compensation_scale (brand, from_s, pct, source_url, source_as_of, note) values
  ('INOUI', 1860, 25, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'plus de 30 min (minutes entières, 31 min et plus)'),
  ('INOUI', 7200, 50, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'de 2 h à 3 h'),
  ('INOUI', 10860, 75, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'au-delà de 3 h (3 h 01 et plus)'),
  ('OUIGO', 3600, 25, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/ouigo/', '2026-09-04', 'de 1 h à 1 h 59'),
  ('OUIGO', 7200, 50, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/ouigo/', '2026-09-04', '2 h et plus');

insert into public.regularity_rule (duration_from_s, max_delay_exclusive_s, source_url) values
  (0, 300, 'https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons'),
  (5400, 600, 'https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons'),
  (10801, 900, 'https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons');

-- Prix moyens HT 2023 (FNAUT d'après l'open data ART) ; le communiqué 2024 ne donne que des évolutions en %.
insert into public.reference_prices (brand, price_eur_ht, seats, price_source, seats_source, as_of) values
  ('INOUI', 46.60, 556, 'https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf (2023, HT)', 'https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf (rame Duplex Océane)', '2023-12-31'),
  ('OUIGO', 34.20, 634, 'https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf (2023, HT)', 'https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf (rame OUIGO)', '2023-12-31');

-- Lecture publique seule : RLS sans politique d'écriture, et droits d'écriture retirés aux rôles clients.
alter table public.compensation_scale enable row level security;
alter table public.regularity_rule enable row level security;
alter table public.reference_prices enable row level security;
revoke insert, update, delete, truncate on public.compensation_scale, public.regularity_rule, public.reference_prices from anon, authenticated;

create policy anon_read on public.compensation_scale for select to anon using (true);
create policy anon_read on public.regularity_rule for select to anon using (true);
create policy anon_read on public.reference_prices for select to anon using (true);
create policy anon_read on public.stop_times_planned for select to anon using (true);
