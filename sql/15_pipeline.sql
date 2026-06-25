-- ============================================================================
-- COMPANIO ENGINE — PIPELINE EXIT STATES  (15; run after 01)
-- Adds 'rejected' to the companion pipeline so applicants who aren't suitable
-- have a real exit (alongside the existing 'offboarded' for leavers).
-- ============================================================================

-- ALTER TYPE ... ADD VALUE can't run inside a transaction block in some tools;
-- if your SQL editor wraps statements, run this line on its own.
alter type companion_status add value if not exists 'rejected';
