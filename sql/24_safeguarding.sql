-- ============================================================================
-- COMPANIO ENGINE — 24 · SAFEGUARDING CONCERNS
-- A first-class, triageable record of concerns raised about a client's
-- welfare — NOT loose free-text on a visit note. Companions raise; operators
-- triage open -> actioned. Nothing here ever silently disappears.
-- Safe to re-run.
-- ============================================================================

do $$ begin
  create type safeguarding_category as enum (
    'wellbeing',          -- seemed low, withdrawn, not themselves
    'self_neglect',       -- not eating, home/hygiene decline
    'cognitive',          -- confusion, memory, disorientation
    'financial',          -- possible exploitation / money worries
    'physical',           -- a fall, injury, bruising, unwell
    'abuse',              -- suspected abuse or mistreatment
    'environment',        -- unsafe home, heating, hazards
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type safeguarding_status as enum ('open','reviewing','actioned','referred','closed');
exception when duplicate_object then null; end $$;

create table if not exists safeguarding_concerns (
  id              uuid primary key default gen_random_uuid(),
  service_user_id uuid references service_users(id) on delete set null,
  companion_id    uuid references companions(id) on delete set null,  -- who raised it
  visit_id        uuid references visits(id) on delete set null,      -- if tied to a visit
  category        safeguarding_category not null default 'wellbeing',
  severity        int not null default 2,         -- 1 low · 2 medium · 3 urgent
  description     text not null,                  -- what they observed
  status          safeguarding_status not null default 'open',
  action_taken    text,                           -- what the operator did
  handled_by      uuid references staff(id) on delete set null,
  raised_at       timestamptz not null default now(),
  actioned_at     timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_safeguarding_open
  on safeguarding_concerns (status, severity desc, raised_at desc);
create index if not exists idx_safeguarding_user
  on safeguarding_concerns (service_user_id);

alter table safeguarding_concerns enable row level security;
