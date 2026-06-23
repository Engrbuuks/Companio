-- ============================================================================
-- COMPANIO ENGINE — PAYMENTS & INVOICING  (06; run after 01–03)
-- Invoices are raised to the REQUESTER (the payer), rolling up the visits
-- delivered to their service user(s) over a period. Payments record receipts.
-- Stripe-ready: stripe_* columns hold the linkage when you wire Stripe later.
-- ============================================================================

do $$ begin
  create type invoice_status as enum ('draft','sent','paid','overdue','void');
  create type payment_method as enum ('stripe','bank_transfer','cash','cheque','other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- INVOICES — one bill to a requester for a period
-- ----------------------------------------------------------------------------
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references requesters(id) on delete restrict,
  number          text unique,                 -- human invoice no., e.g. CMP-2026-0001
  status          invoice_status not null default 'draft',
  period_start    date,
  period_end      date,
  subtotal        numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  amount_paid     numeric(10,2) not null default 0,
  due_date        date,
  notes           text,
  stripe_invoice_id text,
  stripe_payment_intent text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_invoices_requester on invoices(requester_id);
create index if not exists idx_invoices_status on invoices(status);

-- INVOICE LINES — usually one per visit, but free-form lines allowed too
create table if not exists invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  visit_id     uuid references visits(id) on delete set null,
  description  text not null,
  quantity     numeric(8,2) not null default 1,   -- hours
  unit_price   numeric(10,2) not null default 0,   -- £/hr
  amount       numeric(10,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_invoice_lines_invoice on invoice_lines(invoice_id);
create index if not exists idx_invoice_lines_visit on invoice_lines(visit_id);

-- PAYMENTS — receipts against an invoice
create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  amount       numeric(10,2) not null,
  method       payment_method not null default 'stripe',
  reference    text,
  stripe_charge_id text,
  received_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_payments_invoice on payments(invoice_id);

-- mark a flag on visits so we never double-bill
alter table visits add column if not exists invoiced boolean not null default false;

-- ----------------------------------------------------------------------------
-- updated_at trigger for invoices
-- ----------------------------------------------------------------------------
do $$ begin
  drop trigger if exists t_invoices_touch on invoices;
  create trigger t_invoices_touch before update on invoices
    for each row execute function touch_updated_at();
end $$;

-- ----------------------------------------------------------------------------
-- next_invoice_number — sequential, year-prefixed (CMP-2026-0001)
-- ----------------------------------------------------------------------------
create or replace function next_invoice_number() returns text as $$
declare yr text := to_char(now(),'YYYY'); n int;
begin
  select count(*)+1 into n from invoices where number like 'CMP-'||yr||'-%';
  return 'CMP-'||yr||'-'||lpad(n::text,4,'0');
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- generate_invoice — roll a requester's uninvoiced completed visits into an
-- invoice over an optional date window. Returns the new invoice id.
-- ----------------------------------------------------------------------------
create or replace function generate_invoice(
  p_requester uuid,
  p_from date default null,
  p_to date default null
) returns uuid as $$
declare
  inv uuid;
  sub numeric(10,2) := 0;
  v record;
  line_amt numeric(10,2);
  cnt int := 0;
begin
  insert into invoices(requester_id, number, status, period_start, period_end, due_date)
  values (p_requester, next_invoice_number(), 'draft', p_from, p_to,
          (current_date + interval '14 days')::date)
  returning id into inv;

  for v in
    select vs.id as visit_id, vs.scheduled_at, vs.length_hrs,
           coalesce(b.hourly_rate,0) as rate,
           su.full_name as user_name
    from visits vs
    join bookings b on b.id = vs.booking_id
    join service_users su on su.id = b.service_user_id
    where b.requester_id = p_requester
      and vs.status = 'completed'
      and vs.invoiced = false
      and (p_from is null or vs.scheduled_at::date >= p_from)
      and (p_to   is null or vs.scheduled_at::date <= p_to)
  loop
    line_amt := round(v.length_hrs * v.rate, 2);
    insert into invoice_lines(invoice_id, visit_id, description, quantity, unit_price, amount)
    values (inv, v.visit_id,
            v.user_name||' — visit '||to_char(v.scheduled_at,'DD Mon YYYY'),
            v.length_hrs, v.rate, line_amt);
    update visits set invoiced = true where id = v.visit_id;
    sub := sub + line_amt;
    cnt := cnt + 1;
  end loop;

  update invoices set subtotal = sub, total = sub where id = inv;

  -- if nothing to bill, void the empty invoice and return it anyway
  if cnt = 0 then
    update invoices set status = 'void', notes = 'No uninvoiced completed visits in range' where id = inv;
  end if;

  return inv;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- record_payment — log a receipt and advance invoice status when settled
-- ----------------------------------------------------------------------------
create or replace function record_payment(
  p_invoice uuid, p_amount numeric, p_method payment_method default 'bank_transfer', p_ref text default null
) returns void as $$
declare paid numeric(10,2); tot numeric(10,2);
begin
  insert into payments(invoice_id, amount, method, reference)
  values (p_invoice, p_amount, p_method, p_ref);

  select coalesce(sum(amount),0) into paid from payments where invoice_id = p_invoice;
  select total into tot from invoices where id = p_invoice;

  update invoices
    set amount_paid = paid,
        status = case when paid >= tot then 'paid' else status end
    where id = p_invoice;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- billing summary view
-- ----------------------------------------------------------------------------
create or replace view billing_summary as
select i.id, i.number, i.status, r.full_name as requester, r.email,
       i.period_start, i.period_end, i.total, i.amount_paid,
       (i.total - i.amount_paid) as outstanding, i.due_date
from invoices i
join requesters r on r.id = i.requester_id
order by i.created_at desc;
