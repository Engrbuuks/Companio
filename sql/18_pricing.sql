-- ============================================================================
-- COMPANIO ENGINE — PRICING (single source of truth)  (18; run after 12)
-- The website reads ALL pricing from here, so you set prices in ONE place.
--   • plans            → the monthly packages shown on the pricing page
--   • app_settings     → the hourly rates (companionship / help / both)
-- The WordPress pricing page already queries /rest/v1/plans and the hourly
-- rate settings; this makes those queries return real data.
-- ============================================================================

-- ---- Monthly packages -------------------------------------------------------
create table if not exists plans (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,           -- "Weekly", "Twice-Weekly", "Most Days"
  tier            text not null,           -- starter / standard / companion_plus / daily
  visits_per_week int  not null,
  monthly_price   numeric(10,2) not null,  -- £ per month
  blurb           text,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- let the website (anon) read active plans; only staff can change them
alter table plans enable row level security;
drop policy if exists plans_public_read on plans;
create policy plans_public_read on plans for select using ( active = true );
drop policy if exists plans_staff_all on plans;
create policy plans_staff_all on plans for all using ( is_staff() ) with check ( is_staff() );

-- Seed the three packages. EDIT THESE PRICES to your real numbers — this is the
-- single place they live; the website will reflect any change automatically.
insert into plans (label, tier, visits_per_week, monthly_price, blurb, sort_order) values
  ('Weekly',        'starter',        1, 0, 'One visit a week — a friendly face to look forward to.',        1),
  ('Twice-Weekly',  'standard',       2, 0, 'Two visits a week — steady company and a helping hand.',         2),
  ('Most Days',     'companion_plus', 4, 0, 'Four visits a week — for when the days feel long alone.',         3)
on conflict do nothing;

-- ---- Hourly rates (companionship / help / both) -----------------------------
-- Stored in app_settings so the website Customizer fallback and the backend agree.
insert into app_settings (key, value) values
  ('rate_companionship', '28'),
  ('rate_help',          '30'),
  ('rate_both',          '32')
on conflict (key) do update set value = excluded.value;

-- helper the website can call to fetch hourly rates in one go (optional)
create or replace function public_rates() returns table(rate_key text, rate_value text) as $$
  select key, value from app_settings where key in ('rate_companionship','rate_help','rate_both');
$$ language sql stable security definer;
