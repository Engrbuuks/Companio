-- ============================================================================
-- COMPANIO ENGINE — PAYOUTS RLS  (10; run after 09)
-- Finance is staff-only. A companion may READ their own pay accruals and
-- payout runs (so the companion portal can show "what you've earned").
-- ============================================================================

alter table visit_pay enable row level security;
alter table payouts   enable row level security;

drop policy if exists vp_staff_all on visit_pay;
create policy vp_staff_all on visit_pay for all using (is_staff()) with check (is_staff());
drop policy if exists vp_self_read on visit_pay;
create policy vp_self_read on visit_pay for select using (companion_id = my_companion_id());

drop policy if exists po_staff_all on payouts;
create policy po_staff_all on payouts for all using (is_staff()) with check (is_staff());
drop policy if exists po_self_read on payouts;
create policy po_self_read on payouts for select using (companion_id = my_companion_id());
