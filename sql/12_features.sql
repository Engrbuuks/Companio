-- ============================================================================
-- COMPANIO ENGINE — ACTIVATE-WHEN-READY FEATURES  (12; run after 11)
-- Everything here ships DORMANT. Each capability is gated behind a feature
-- flag and does nothing until you switch it on in Settings. The schema,
-- functions and UI all exist — they just wait for you to be ready.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FEATURE FLAGS — reuse app_settings (from 08) as the master control panel.
-- A flag is just a row with key 'feature.<name>' and value 'on'/'off'.
-- ----------------------------------------------------------------------------
insert into app_settings(key,value) values
  ('feature.stripe',     'off'),   -- take real card payments
  ('feature.reminders',  'off'),   -- auto visit reminders
  ('feature.documents',  'on'),    -- attach DBS/ID/agreements (safe to have on)
  ('feature.reporting',  'on')     -- trend reporting (renders, fills as data grows)
on conflict (key) do nothing;       -- never clobber a choice you've already made

create or replace function feature_on(p_name text) returns boolean as $$
  select coalesce((select value from app_settings where key = 'feature.'||p_name), 'off') = 'on';
$$ language sql stable;

-- a tidy view of the control panel for the Settings UI
create or replace view feature_flags as
select replace(key,'feature.','') as feature, value as state
from app_settings where key like 'feature.%' order by key;

-- setter the dashboard Settings panel calls to flip a flag
create or replace function set_feature(p_name text, p_state text) returns void as $$
begin
  insert into app_settings(key, value) values ('feature.'||p_name, p_state)
  on conflict (key) do update set value = excluded.value;
end $$ language plpgsql security definer;

-- ============================================================================
-- 1. STRIPE (dormant) — adds the columns/functions to take card payments.
--    Nothing charges until feature.stripe='on' AND keys are set.
-- ============================================================================
alter table invoices add column if not exists stripe_checkout_url text;
alter table invoices add column if not exists stripe_session_id text;
alter table invoices add column if not exists paid_online boolean not null default false;

-- request a checkout link for an invoice. Returns a marker the Edge Function
-- (create-checkout) fills in. If Stripe is off, it no-ops and says so.
create or replace function request_checkout(p_invoice uuid) returns text as $$
declare ok boolean;
begin
  select feature_on('stripe') into ok;
  if not ok then return 'stripe_disabled'; end if;
  -- mark the invoice as awaiting a checkout link; the Edge Function picks this up
  update invoices set status = case when status='draft' then 'sent' else status end
    where id = p_invoice;
  return 'requested';
end $$ language plpgsql;

-- called by the Stripe webhook (via Edge Function) when payment succeeds
create or replace function stripe_mark_paid(p_session text, p_charge text default null) returns void as $$
declare inv uuid; tot numeric(10,2);
begin
  select id, total into inv, tot from invoices where stripe_session_id = p_session;
  if inv is null then return; end if;
  perform record_payment(inv, tot, 'stripe', p_charge);
  update invoices set paid_online = true where id = inv;
end $$ language plpgsql;

-- ============================================================================
-- 2. VISIT REMINDERS (dormant) — queue reminders, send when feature is on.
-- ============================================================================
create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  send_at     timestamptz not null,
  channel     text not null default 'email',  -- email | sms
  audience    text not null default 'both',   -- family | companion | both
  sent        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_reminders_due on reminders(send_at) where sent = false;

-- when a visit is scheduled, queue a reminder 24h before (only if feature on)
create or replace function queue_reminder() returns trigger as $$
begin
  if feature_on('reminders') and new.status = 'scheduled' then
    insert into reminders(visit_id, send_at, audience)
    values (new.id, new.scheduled_at - interval '24 hours', 'both');
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_queue_reminder on visits;
create trigger t_queue_reminder after insert on visits
  for each row execute function queue_reminder();

-- the due-reminders feed a scheduled job/Edge Function reads
create or replace function due_reminders() returns setof reminders as $$
  select * from reminders where sent = false and send_at <= now() and feature_on('reminders');
$$ language sql stable;

-- ============================================================================
-- 3. DOCUMENT STORAGE — metadata table (files live in a Supabase Storage bucket
--    named 'companio-docs'). Ready to use immediately.
-- ============================================================================
do $$ begin
  create type doc_kind as enum ('dbs','id','reference','agreement','insurance','other');
exception when duplicate_object then null; end $$;

create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  kind          doc_kind not null default 'other',
  -- attach to a companion OR a requester OR a service_user (one of)
  companion_id  uuid references companions(id) on delete cascade,
  requester_id  uuid references requesters(id) on delete cascade,
  service_user_id uuid references service_users(id) on delete cascade,
  label         text not null,
  storage_path  text,                       -- path in the storage bucket
  expires_on    date,                        -- e.g. DBS renewal date
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_documents_companion on documents(companion_id);

alter table documents enable row level security;
drop policy if exists doc_staff_all on documents;
create policy doc_staff_all on documents for all using (is_staff()) with check (is_staff());
-- a companion may see their own documents
drop policy if exists doc_self on documents;
create policy doc_self on documents for select using (companion_id = my_companion_id());

-- ============================================================================
-- 4. REPORTING (live, fills as data grows)
-- ============================================================================

-- monthly revenue + cost + margin trend
create or replace view report_monthly as
with months as (
  select date_trunc('month', d)::date as m
  from generate_series(current_date - interval '5 months', current_date, interval '1 month') d
),
rev as (
  select date_trunc('month', period_end)::date as m, sum(total) as invoiced, sum(amount_paid) as collected
  from invoices where status <> 'void' group by 1
),
cost as (
  select date_trunc('month', v.scheduled_at)::date as m, sum(vp.amount) as companion_cost
  from visit_pay vp join visits v on v.id = vp.visit_id group by 1
)
select to_char(months.m,'Mon YYYY') as month, months.m as month_date,
       coalesce(rev.invoiced,0) as revenue,
       coalesce(rev.collected,0) as collected,
       coalesce(cost.companion_cost,0) as companion_cost,
       coalesce(rev.invoiced,0) - coalesce(cost.companion_cost,0) as margin
from months
left join rev on rev.m = months.m
left join cost on cost.m = months.m
order by months.m;

-- client retention: active bookings vs ended, by month started
create or replace view report_retention as
select to_char(date_trunc('month', start_date),'Mon YYYY') as cohort,
       count(*) as clients_started,
       count(*) filter (where status = 'active') as still_active,
       count(*) filter (where status in ('cancelled','completed','paused')) as ended
from bookings where start_date is not null
group by date_trunc('month', start_date)
order by date_trunc('month', start_date);

-- companion utilisation: completed visit-hours per companion, last 30 days
create or replace view report_utilisation as
select c.full_name,
       coalesce(sum(v.length_hrs) filter (where v.status='completed' and v.scheduled_at >= now() - interval '30 days'),0) as hours_30d,
       count(v.id) filter (where v.status='completed' and v.scheduled_at >= now() - interval '30 days') as visits_30d
from companions c
left join visits v on v.companion_id = c.id
where c.status = 'active'
group by c.id, c.full_name
order by hours_30d desc;
