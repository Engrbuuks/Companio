-- ============================================================================
-- COMPANIO ENGINE — PAYMENTS RLS  (07; run after 06)
-- Staff manage everything. Requesters may READ their own invoices, lines,
-- and payments — so the requester portal can show "what you owe / have paid".
-- ============================================================================

alter table invoices      enable row level security;
alter table invoice_lines enable row level security;
alter table payments      enable row level security;

-- INVOICES
drop policy if exists inv_staff_all on invoices;
create policy inv_staff_all on invoices for all using (is_staff()) with check (is_staff());
drop policy if exists inv_requester_read on invoices;
create policy inv_requester_read on invoices for select using (requester_id = my_requester_id());

-- INVOICE LINES (visible if you can see the parent invoice)
drop policy if exists invl_staff_all on invoice_lines;
create policy invl_staff_all on invoice_lines for all using (is_staff()) with check (is_staff());
drop policy if exists invl_requester_read on invoice_lines;
create policy invl_requester_read on invoice_lines for select using (
  exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.requester_id = my_requester_id())
);

-- PAYMENTS
drop policy if exists pay_staff_all on payments;
create policy pay_staff_all on payments for all using (is_staff()) with check (is_staff());
drop policy if exists pay_requester_read on payments;
create policy pay_requester_read on payments for select using (
  exists (select 1 from invoices i where i.id = payments.invoice_id and i.requester_id = my_requester_id())
);
