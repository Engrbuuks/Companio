-- ============================================================================
-- COMPANIO ENGINE — CORE SCHEMA
-- Roles: Companio (operator) · Companion (supply) · Requester (buyer) · User (recipient)
-- Postgres / Supabase. Run in order: 01_schema → 02_rls → 03_functions → 04_seed
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";      -- case-insensitive email

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
do $$ begin
  create type service_kind        as enum ('companionship','help','both');
  create type frequency_kind      as enum ('weekly','twice_weekly','most_days','adhoc');
  create type companion_status    as enum ('applicant','vetting','active','paused','offboarded');
  create type dbs_status          as enum ('none','submitted','cleared','expired');
  create type requester_status    as enum ('lead','active','paused','closed');
  create type booking_status      as enum ('draft','proposed','active','paused','cancelled','completed');
  create type visit_status        as enum ('scheduled','completed','cancelled','no_access','reassigned');
  create type match_status        as enum ('suggested','introduced','accepted','declined');
  create type weekday             as enum ('mon','tue','wed','thu','fri','sat','sun');
  create type relationship_kind   as enum ('adult_child','spouse','sibling','friend','self','professional','other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. STAFF (Companio operators) — links to Supabase auth.users
-- ----------------------------------------------------------------------------
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                 -- references auth.users(id) in Supabase
  full_name     text not null,
  email         citext unique not null,
  is_admin      boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. COMPANIONS (supply side)
-- ----------------------------------------------------------------------------
create table if not exists companions (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,               -- companion login (optional, for self-service)
  full_name       text not null,
  email           citext unique not null,
  phone           text,
  city            text,
  postcode        text,
  bio             text,
  status          companion_status not null default 'applicant',
  -- vetting
  dbs             dbs_status not null default 'none',
  dbs_cleared_on  date,
  references_ok   boolean not null default false,
  trained_on      date,
  -- service capability + pay
  offers          service_kind not null default 'both',
  max_clients     int not null default 8,
  hourly_pay      numeric(6,2),              -- what Companio pays them
  -- personality/matching signals (kept simple + queryable)
  interests       text[] not null default '{}',   -- e.g. {gardening,music,cards,tech}
  temperament     text,                            -- e.g. 'calm','playful','chatty'
  has_car         boolean not null default false,
  applied_at      timestamptz not null default now(),
  notes           text,                            -- internal ops notes
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_companions_status on companions(status);
create index if not exists idx_companions_city on companions(lower(city));

-- Companion weekly availability (recurring slots)
create table if not exists companion_availability (
  id            uuid primary key default gen_random_uuid(),
  companion_id  uuid not null references companions(id) on delete cascade,
  day           weekday not null,
  start_time    time not null,
  end_time      time not null,
  created_at    timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists idx_avail_companion on companion_availability(companion_id);

-- ----------------------------------------------------------------------------
-- 3. REQUESTERS (the buyer — usually the adult child)
-- ----------------------------------------------------------------------------
create table if not exists requesters (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                 -- requester login (optional)
  full_name     text not null,
  email         citext unique not null,
  phone         text,
  status        requester_status not null default 'lead',
  -- where the lead came from (ties to the website funnel)
  source        text,                        -- 'website','matcher','referral','phone'
  matcher_notes text,                        -- the matcher summary captured on the site
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_requesters_status on requesters(status);

-- ----------------------------------------------------------------------------
-- 4. SERVICE USERS (the person who receives visits — usually the parent)
--    A requester can arrange for one or more users (e.g. both parents).
-- ----------------------------------------------------------------------------
create table if not exists service_users (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references requesters(id) on delete cascade,
  full_name       text not null,
  relationship    relationship_kind not null default 'adult_child', -- requester's relationship TO the user
  phone           text,
  address_line    text,
  city            text,
  postcode        text,
  -- who they are, for matching
  interests       text[] not null default '{}',
  temperament     text,
  notes           text,                       -- access notes, preferences, sensitivities
  mobility_notes  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_users_requester on service_users(requester_id);
create index if not exists idx_users_postcode on service_users(lower(postcode));

-- ----------------------------------------------------------------------------
-- 5. BOOKINGS (an ongoing arrangement: which user, what service, how often, who pays)
-- ----------------------------------------------------------------------------
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references requesters(id) on delete restrict,
  service_user_id uuid not null references service_users(id) on delete restrict,
  companion_id    uuid references companions(id) on delete set null,  -- assigned companion
  service         service_kind not null default 'companionship',
  frequency       frequency_kind not null default 'weekly',
  hourly_rate     numeric(6,2),               -- what the requester pays Companio
  visit_length_hrs numeric(4,2) not null default 2,
  status          booking_status not null default 'draft',
  start_date      date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_bookings_status on bookings(status);
create index if not exists idx_bookings_companion on bookings(companion_id);
create index if not exists idx_bookings_user on bookings(service_user_id);

-- ----------------------------------------------------------------------------
-- 6. VISITS (individual scheduled occurrences of a booking)
-- ----------------------------------------------------------------------------
create table if not exists visits (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  companion_id  uuid references companions(id) on delete set null,
  scheduled_at  timestamptz not null,
  length_hrs    numeric(4,2) not null default 2,
  status        visit_status not null default 'scheduled',
  created_at    timestamptz not null default now()
);
create index if not exists idx_visits_booking on visits(booking_id);
create index if not exists idx_visits_when on visits(scheduled_at);
create index if not exists idx_visits_companion on visits(companion_id);

-- ----------------------------------------------------------------------------
-- 7. VISIT NOTES (the "note to family" after every visit — a core promise)
-- ----------------------------------------------------------------------------
create table if not exists visit_notes (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references visits(id) on delete cascade,
  companion_id  uuid references companions(id) on delete set null,
  summary       text not null,               -- warm note shared with the family
  internal_flag text,                        -- ops-only concern, not shared (e.g. 'seemed low')
  shared_with_family boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notes_visit on visit_notes(visit_id);

-- ----------------------------------------------------------------------------
-- 8. MATCHES (suggested companion↔user pairings, with a score + lifecycle)
-- ----------------------------------------------------------------------------
create table if not exists matches (
  id              uuid primary key default gen_random_uuid(),
  service_user_id uuid not null references service_users(id) on delete cascade,
  companion_id    uuid not null references companions(id) on delete cascade,
  score           int not null default 0,     -- 0-100, from the matching function
  reasons         text[] not null default '{}',
  status          match_status not null default 'suggested',
  created_at      timestamptz not null default now(),
  unique (service_user_id, companion_id)
);
create index if not exists idx_matches_user on matches(service_user_id);
create index if not exists idx_matches_companion on matches(companion_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

do $$ begin
  perform 1;
  drop trigger if exists t_companions_touch on companions;
  create trigger t_companions_touch before update on companions for each row execute function touch_updated_at();
  drop trigger if exists t_requesters_touch on requesters;
  create trigger t_requesters_touch before update on requesters for each row execute function touch_updated_at();
  drop trigger if exists t_users_touch on service_users;
  create trigger t_users_touch before update on service_users for each row execute function touch_updated_at();
  drop trigger if exists t_bookings_touch on bookings;
  create trigger t_bookings_touch before update on bookings for each row execute function touch_updated_at();
end $$;
