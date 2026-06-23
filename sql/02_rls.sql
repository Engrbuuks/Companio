-- ============================================================================
-- COMPANIO ENGINE — ROW-LEVEL SECURITY
-- Principle: vulnerable people's data is locked down by default.
--   · Staff (Companio operators) see/do everything.
--   · Companions see only their own profile, visits, bookings, notes.
--   · Requesters see only their own users, bookings, visits.
--   · Service users have no login (they're represented by their requester).
-- Supabase exposes the logged-in user as auth.uid().
-- ============================================================================

-- helper: is the current auth user a Companio staff member?
create or replace function is_staff() returns boolean as $$
  select exists(select 1 from staff where auth_user_id = auth.uid() and active);
$$ language sql stable security definer;

-- helper: the companion row for the current auth user (if any)
create or replace function my_companion_id() returns uuid as $$
  select id from companions where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- helper: the requester row for the current auth user (if any)
create or replace function my_requester_id() returns uuid as $$
  select id from requesters where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- enable RLS
alter table staff                  enable row level security;
alter table companions             enable row level security;
alter table companion_availability enable row level security;
alter table requesters             enable row level security;
alter table service_users          enable row level security;
alter table bookings               enable row level security;
alter table visits                 enable row level security;
alter table visit_notes            enable row level security;
alter table matches                enable row level security;

-- ---- STAFF: only staff can read the staff table; admins manage it ----
drop policy if exists staff_read on staff;
create policy staff_read on staff for select using (is_staff());

-- ---- COMPANIONS ----
drop policy if exists comp_staff_all on companions;
create policy comp_staff_all on companions for all using (is_staff()) with check (is_staff());
drop policy if exists comp_self_read on companions;
create policy comp_self_read on companions for select using (auth_user_id = auth.uid());
drop policy if exists comp_self_update on companions;
create policy comp_self_update on companions for update using (auth_user_id = auth.uid());

-- ---- COMPANION AVAILABILITY ----
drop policy if exists avail_staff_all on companion_availability;
create policy avail_staff_all on companion_availability for all using (is_staff()) with check (is_staff());
drop policy if exists avail_self on companion_availability;
create policy avail_self on companion_availability for all
  using (companion_id = my_companion_id()) with check (companion_id = my_companion_id());

-- ---- REQUESTERS ----
drop policy if exists req_staff_all on requesters;
create policy req_staff_all on requesters for all using (is_staff()) with check (is_staff());
drop policy if exists req_self on requesters;
create policy req_self on requesters for all
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- ---- SERVICE USERS (visible to their requester + staff) ----
drop policy if exists su_staff_all on service_users;
create policy su_staff_all on service_users for all using (is_staff()) with check (is_staff());
drop policy if exists su_owner on service_users;
create policy su_owner on service_users for all
  using (requester_id = my_requester_id()) with check (requester_id = my_requester_id());
-- a companion may READ users they are matched to or booked with
drop policy if exists su_companion_read on service_users;
create policy su_companion_read on service_users for select using (
  exists(select 1 from bookings b where b.service_user_id = service_users.id and b.companion_id = my_companion_id())
  or exists(select 1 from matches m where m.service_user_id = service_users.id and m.companion_id = my_companion_id())
);

-- ---- BOOKINGS ----
drop policy if exists bk_staff_all on bookings;
create policy bk_staff_all on bookings for all using (is_staff()) with check (is_staff());
drop policy if exists bk_requester_read on bookings;
create policy bk_requester_read on bookings for select using (requester_id = my_requester_id());
drop policy if exists bk_companion_read on bookings;
create policy bk_companion_read on bookings for select using (companion_id = my_companion_id());

-- ---- VISITS ----
drop policy if exists v_staff_all on visits;
create policy v_staff_all on visits for all using (is_staff()) with check (is_staff());
drop policy if exists v_companion on visits;
create policy v_companion on visits for select using (companion_id = my_companion_id());
drop policy if exists v_companion_update on visits;
create policy v_companion_update on visits for update using (companion_id = my_companion_id());
drop policy if exists v_requester_read on visits;
create policy v_requester_read on visits for select using (
  exists(select 1 from bookings b where b.id = visits.booking_id and b.requester_id = my_requester_id())
);

-- ---- VISIT NOTES ----
drop policy if exists vn_staff_all on visit_notes;
create policy vn_staff_all on visit_notes for all using (is_staff()) with check (is_staff());
-- companion writes notes for their own visits
drop policy if exists vn_companion_write on visit_notes;
create policy vn_companion_write on visit_notes for all
  using (companion_id = my_companion_id()) with check (companion_id = my_companion_id());
-- requester reads notes shared with family, for their own bookings' visits
drop policy if exists vn_requester_read on visit_notes;
create policy vn_requester_read on visit_notes for select using (
  shared_with_family and exists(
    select 1 from visits v join bookings b on b.id = v.booking_id
    where v.id = visit_notes.visit_id and b.requester_id = my_requester_id()
  )
);

-- ---- MATCHES (staff only; companions may see their own suggestions) ----
drop policy if exists m_staff_all on matches;
create policy m_staff_all on matches for all using (is_staff()) with check (is_staff());
drop policy if exists m_companion_read on matches;
create policy m_companion_read on matches for select using (companion_id = my_companion_id());
