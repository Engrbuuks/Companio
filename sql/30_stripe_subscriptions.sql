-- ============================================================
--  30_stripe_subscriptions.sql  —  RECURRING MEMBERSHIPS
-- ============================================================
--  Adds the tables Stripe needs to bill families monthly.
--  Nothing charges until:
--    • the stripe-checkout / stripe-webhook functions are deployed,
--    • your Stripe secret + webhook keys are set as function secrets,
--    • feature.stripe = 'on'.
--  Safe to run now — it only creates structure.
-- ============================================================

-- One Stripe customer per family (requester) -----------------
alter table requesters add column if not exists stripe_customer_id text;

-- Membership plans the operator can sell (mirror of the website
-- tiers). price_id links to a recurring Price in your Stripe
-- dashboard. Edit amounts in Stripe; keep the ids in sync here.
create table if not exists membership_plans (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,          -- 'weekly' | 'companion' | 'concierge' | 'custom'
  name          text not null,
  monthly_price numeric(10,2) not null,         -- display only (£/mo)
  stripe_price_id text,                          -- Stripe recurring Price id (price_...)
  visits_per_week int,
  hours_per_visit numeric(4,2),
  service       text default 'both',
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- A family's live membership (one active per requester) -------
do $$ begin
  create type membership_status as enum
    ('incomplete','trialing','active','past_due','paused','canceled');
exception when duplicate_object then null; end $$;

create table if not exists memberships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references requesters(id) on delete cascade,
  plan_key      text,                            -- which plan they chose
  status        membership_status not null default 'incomplete',
  monthly_price numeric(10,2),
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_memberships_requester on memberships(requester_id);
create index if not exists idx_memberships_sub on memberships(stripe_subscription_id);

-- seed the standard plans (prices match the website tiers; fill
-- stripe_price_id after you create the Prices in Stripe) --------
insert into membership_plans(key,name,monthly_price,visits_per_week,hours_per_visit,service,sort_order) values
  ('weekly',    'Weekly',    260,  1, 2, 'companionship', 1),
  ('companion', 'Companion', 570,  2, 2, 'both',          2),
  ('concierge', 'Concierge', 1110, 4, 2, 'both',          3)
on conflict (key) do nothing;

-- RLS --------------------------------------------------------
alter table membership_plans enable row level security;
alter table memberships      enable row level security;

-- plans are readable by anyone signed in (the website reads price tiers)
drop policy if exists mplans_read on membership_plans;
create policy mplans_read on membership_plans for select using (true);

-- staff manage everything
drop policy if exists mplans_staff on membership_plans;
create policy mplans_staff on membership_plans for all
  using (exists(select 1 from staff where auth_user_id = auth.uid() and active))
  with check (exists(select 1 from staff where auth_user_id = auth.uid() and active));

drop policy if exists memberships_staff on memberships;
create policy memberships_staff on memberships for all
  using (exists(select 1 from staff where auth_user_id = auth.uid() and active))
  with check (exists(select 1 from staff where auth_user_id = auth.uid() and active));

-- a family can see their OWN membership (for the family portal)
drop policy if exists memberships_own on memberships;
create policy memberships_own on memberships for select
  using (requester_id in (select id from requesters where auth_user_id = auth.uid()));

-- the webhook writes via the service role, which bypasses RLS — good.
