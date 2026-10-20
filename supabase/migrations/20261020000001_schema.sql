-- Schéma de la collecte : référentiel théorique, état des circulations, journal d'événements.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.stops (
  stop_id text primary key,
  name text not null,
  lat double precision,
  lon double precision
);

create table public.trips_planned (
  service_date date,
  trip_id text,
  brand text not null check (brand in ('INOUI', 'OUIGO')),
  train_number text not null,
  axis text not null check (axis in ('NORD', 'SUD_EST', 'ATLANTIQUE', 'EST', 'INTERSECTEURS')),
  origin_stop_id text,
  dest_stop_id text,
  dep_planned timestamptz,
  arr_planned timestamptz,
  primary key (service_date, trip_id)
);

create table public.stop_times_planned (
  service_date date,
  trip_id text,
  stop_sequence int,
  stop_id text,
  arr_planned timestamptz,
  dep_planned timestamptz,
  primary key (service_date, trip_id, stop_sequence)
);

-- stop_delays : stop_sequence (en chaîne) -> retard en secondes, ou "cancelled".
create table public.circulations (
  service_date date,
  trip_id text,
  brand text check (brand in ('INOUI', 'OUIGO')),
  axis text check (axis in ('NORD', 'SUD_EST', 'ATLANTIQUE', 'EST', 'INTERSECTEURS')),
  train_number text,
  arr_planned timestamptz,
  cancelled boolean not null default false,
  stop_delays jsonb not null default '{}',
  terminus_delay_s int,
  max_delay_s int,
  alert_ids text[] not null default '{}',
  cause text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  primary key (service_date, trip_id)
);

-- Journal append-only : seul le DELETE de la purge (après export) est permis.
create table public.events (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  service_date date not null,
  trip_id text not null,
  kind text not null check (kind in ('first_seen', 'delay', 'stop_cancelled', 'cancelled', 'uncancelled', 'alert_added', 'alert_removed')),
  stop_sequence int,
  value jsonb not null
);
create index events_observed_at_idx on public.events (observed_at);

create function public.forbid_events_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'events est append-only : UPDATE interdit';
end;
$$;
revoke execute on function public.forbid_events_update() from public, anon, authenticated;

create trigger events_no_update before update on public.events
  for each statement execute function public.forbid_events_update();

create table public.exports (
  month date primary key,
  release_url text not null,
  row_count int not null,
  exported_at timestamptz not null default now()
);

create table public.collector_state (
  id int primary key check (id = 1),
  last_feed_ts bigint,
  last_run_at timestamptz,
  last_error text
);

-- RLS partout ; lecture publique sauf events et collector_state.
alter table public.stops enable row level security;
alter table public.trips_planned enable row level security;
alter table public.stop_times_planned enable row level security;
alter table public.circulations enable row level security;
alter table public.events enable row level security;
alter table public.exports enable row level security;
alter table public.collector_state enable row level security;

create policy anon_read on public.stops for select to anon using (true);
create policy anon_read on public.trips_planned for select to anon using (true);
create policy anon_read on public.circulations for select to anon using (true);
create policy anon_read on public.exports for select to anon using (true);
