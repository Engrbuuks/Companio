-- ============================================================
--  29_clean_launch.sql  —  WIPE DEMO / SEED DATA FOR GO-LIVE
-- ============================================================
--  Run this ONCE, just before launch, to clear all the sample
--  people, bookings, visits, invoices and other demo rows that
--  came from 04_seed.sql (and anything created while testing).
--
--  WHAT IT CLEARS (operational data):
--    safeguarding_concerns, wellbeing_checkins, reminders,
--    payouts, payments, invoice_lines, invoices, visit_pay,
--    visit_notes, visits, bookings, matches, documents,
--    enquiries, companion_availability, service_users,
--    requesters, companions
--
--  WHAT IT KEEPS (your real setup — untouched):
--    • staff            (your operator login)
--    • plans            (pricing tiers)
--    • app_settings     (rates, feature flags, AI, theme, etc.)
--    • email_templates / text_overrides (branding & copy)
--    • the whole schema, all functions, all RLS policies
--
--  Safe to run on an already-clean database (deletes nothing
--  if the tables are empty). Order respects foreign keys.
--
--  ⚠️  This permanently deletes the rows. There is no undo.
--      If unsure, take a Supabase backup first
--      (Dashboard → Database → Backups).
-- ============================================================

begin;

-- children first (things that reference other rows) -----------
delete from safeguarding_concerns;
delete from wellbeing_checkins;
delete from reminders;
delete from payouts;
delete from payments;
delete from invoice_lines;
delete from invoices;
delete from visit_pay;
delete from visit_notes;
delete from visits;
delete from bookings;
delete from matches;
delete from documents;
delete from enquiries;
delete from companion_availability;

-- people / parents -------------------------------------------
delete from service_users;
delete from requesters;
delete from companions;

-- NOTE: staff is intentionally NOT cleared, so your operator
-- login (hello@mycompanio.co.uk) keeps working. If you want a
-- truly empty staff table too, uncomment the next line — but
-- only after confirming you have another way to log in:
-- delete from staff where email <> 'hello@mycompanio.co.uk';

commit;

-- ---------- verify it's clean (optional; run separately) ----
-- select 'companions' t, count(*) from companions
-- union all select 'requesters', count(*) from requesters
-- union all select 'service_users', count(*) from service_users
-- union all select 'bookings', count(*) from bookings
-- union all select 'visits', count(*) from visits
-- union all select 'invoices', count(*) from invoices
-- union all select 'enquiries', count(*) from enquiries
-- union all select 'staff (kept)', count(*) from staff
-- union all select 'plans (kept)', count(*) from plans;
