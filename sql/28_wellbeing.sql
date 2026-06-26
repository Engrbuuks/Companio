-- ============================================================================
-- COMPANIO ENGINE — 28 · WELLBEING CHECK-INS
-- A gentle, evidence-informed wellbeing snapshot (based on the De Jong Gierveld
-- 6-item loneliness scale). Captured at intake from the website, and logged
-- again over time once someone is a client — so you can see the trend.
--
-- IMPORTANT FRAMING: this is a wellbeing *reflection*, not a clinical diagnosis.
-- The score is a conversation starter, never a label applied to a person.
-- Safe to re-run.
-- ============================================================================

create table if not exists wellbeing_checkins (
  id              uuid primary key default gen_random_uuid(),
  -- linkage (any may be null at intake, before they're a client)
  service_user_id uuid references service_users(id) on delete set null,
  enquiry_id      uuid references enquiries(id) on delete set null,
  -- raw answers: 6 items, each 0-2 (De Jong Gierveld scoring)
  answers         int[] not null default '{}',
  -- derived: 0-6 loneliness indication (higher = more lonely)
  score           int not null default 0,
  band            text not null default 'not_lonely',  -- not_lonely | moderate | strong
  -- who/where it came from
  source          text not null default 'website',     -- website | operator | companion
  taken_for       text,                                -- 'myself' | 'someone I care about'
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_wellbeing_user on wellbeing_checkins(service_user_id, created_at desc);
create index if not exists idx_wellbeing_enquiry on wellbeing_checkins(enquiry_id);

alter table wellbeing_checkins enable row level security;

-- Staff manage everything; companions may read check-ins for their own clients
-- (so a companion can see how the person they visit is trending).
drop policy if exists wb_staff_all on wellbeing_checkins;
create policy wb_staff_all on wellbeing_checkins
  for all using (is_staff()) with check (is_staff());

-- Allow anonymous/public INSERT of an intake snapshot from the website form
-- path is handled server-side via the service key, so no public policy needed.

-- A companion can read check-ins for a service user they have an active booking with.
drop policy if exists wb_comp_read on wellbeing_checkins;
create policy wb_comp_read on wellbeing_checkins
  for select using (
    service_user_id in (
      select b.service_user_id from bookings b
      where b.companion_id = my_companion_id() and b.status = 'active'
    )
  );
