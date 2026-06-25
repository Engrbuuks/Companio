-- ============================================================================
-- COMPANIO ENGINE — APP_SETTINGS RLS FIX  (22; run anytime after 08)
-- app_settings was created without read policies, so with RLS on (Supabase
-- default) every read returned empty — which made the dashboard think the
-- functions URL / feature flags were "not configured" even when the rows
-- existed. This grants read to logged-in users and write to staff.
-- ============================================================================

alter table app_settings enable row level security;

-- any logged-in user (staff, companion, requester) may READ settings
-- (needed so the dashboard can find ai_functions_url, feature flags, etc.)
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings
  for select
  to authenticated
  using (true);

-- only staff may CHANGE settings
drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings
  for all
  to authenticated
  using (is_staff())
  with check (is_staff());

-- make sure the functions URL row exists (idempotent).
-- ⚠ EDIT this if your project ref differs — find it in Supabase →
--   Edge Functions → any function → the invoke URL before the function name.
insert into app_settings (key, value)
values ('ai_functions_url', 'https://bouyfsfcfjeordmaaaof.functions.supabase.co')
on conflict (key) do update set value = excluded.value;
