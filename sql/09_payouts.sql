-- ============================================================================
-- COMPANIO ENGINE — PAYOUTS & FINANCE  (09; run after 06/07)
-- The money-OUT side + the full-cycle "complete a visit" control.
--
-- The spine:  complete_visit(visit) →
--     • marks the visit completed
--     • accrues companion pay (visit_pay row) at their hourly_pay
--     • leaves it billable to the requester (invoiced=false)
--   Then: generate_invoice() bills the requester (money in, from 06)
--         run_payout()       pays the companion (money out, here)
--   Finance view nets the two into live revenue / cost / margin.
-- ============================================================================

do $$ begin
  create type payout_status as enum ('accrued','paid','void');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- VISIT PAY — one accrual row per completed visit (what we owe the companion)
-- ----------------------------------------------------------------------------
create table if not exists visit_pay (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null unique references visits(id) on delete cascade,
  companion_id  uuid not null references companions(id) on delete restrict,
  hours         numeric(5,2) not null,
  rate          numeric(6,2) not null,        -- companion's hourly_pay at the time
  amount        numeric(8,2) not null,        -- hours * rate
  status        payout_status not null default 'accrued',
  payout_id     uuid,                          -- set when rolled into a payout run
  created_at    timestamptz not null default now()
);
create index if not exists idx_visit_pay_companion on visit_pay(companion_id);
create index if not exists idx_visit_pay_status on visit_pay(status);

-- PAYOUTS — a payment run to a companion covering N accrued visits
create table if not exists payouts (
  id            uuid primary key default gen_random_uuid(),
  companion_id  uuid not null references companions(id) on delete restrict,
  reference     text unique,                   -- PAY-2026-0001
  period_start  date,
  period_end    date,
  total         numeric(10,2) not null default 0,
  status        payout_status not null default 'accrued',
  paid_at       timestamptz,
  method        payment_method not null default 'bank_transfer',
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_payouts_companion on payouts(companion_id);
create index if not exists idx_payouts_status on payouts(status);

-- ----------------------------------------------------------------------------
-- THE SPINE: complete_visit — the single control that closes a visit
--   Marks it completed (idempotent) and accrues the companion's pay.
--   The note-to-family + billing flow from existing triggers/functions
--   all hang off the visit being 'completed'.
-- ----------------------------------------------------------------------------
create or replace function complete_visit(p_visit uuid) returns void as $$
declare v visits; pay_rate numeric(6,2);
begin
  select * into v from visits where id = p_visit;
  if v is null then raise exception 'visit % not found', p_visit; end if;
  if v.status = 'completed' then return; end if;          -- idempotent

  update visits set status = 'completed' where id = p_visit;

  -- accrue companion pay (only if a companion is assigned and not already accrued)
  if v.companion_id is not null and not exists(select 1 from visit_pay where visit_id = p_visit) then
    select hourly_pay into pay_rate from companions where id = v.companion_id;
    pay_rate := coalesce(pay_rate, 0);
    insert into visit_pay(visit_id, companion_id, hours, rate, amount)
    values (p_visit, v.companion_id, v.length_hrs, pay_rate, round(v.length_hrs * pay_rate, 2));
  end if;
end $$ language plpgsql;

-- also handle other terminal states cleanly (no pay accrues)
create or replace function set_visit_status(p_visit uuid, p_status visit_status) returns void as $$
begin
  if p_status = 'completed' then perform complete_visit(p_visit);
  else update visits set status = p_status where id = p_visit;
  end if;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- next_payout_reference
-- ----------------------------------------------------------------------------
create or replace function next_payout_reference() returns text as $$
declare yr text := to_char(now(),'YYYY'); n int;
begin
  select count(*)+1 into n from payouts where reference like 'PAY-'||yr||'-%';
  return 'PAY-'||yr||'-'||lpad(n::text,4,'0');
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- run_payout — roll a companion's accrued visit_pay into a payout run
-- ----------------------------------------------------------------------------
create or replace function run_payout(p_companion uuid, p_from date default null, p_to date default null)
returns uuid as $$
declare po uuid; tot numeric(10,2) := 0; r record; cnt int := 0;
begin
  insert into payouts(companion_id, reference, period_start, period_end, status)
  values (p_companion, next_payout_reference(), p_from, p_to, 'accrued')
  returning id into po;

  for r in
    select vp.id, vp.amount from visit_pay vp
    join visits v on v.id = vp.visit_id
    where vp.companion_id = p_companion and vp.status = 'accrued'
      and (p_from is null or v.scheduled_at::date >= p_from)
      and (p_to   is null or v.scheduled_at::date <= p_to)
  loop
    update visit_pay set payout_id = po where id = r.id;
    tot := tot + r.amount; cnt := cnt + 1;
  end loop;

  update payouts set total = tot where id = po;
  if cnt = 0 then update payouts set status='void', notes='No accrued pay in range' where id = po; end if;
  return po;
end $$ language plpgsql;

-- mark_payout_paid — settle a payout run
create or replace function mark_payout_paid(p_payout uuid, p_method payment_method default 'bank_transfer')
returns void as $$
begin
  update payouts set status='paid', paid_at=now(), method=p_method where id = p_payout;
  update visit_pay set status='paid' where payout_id = p_payout;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- FINANCE VIEWS
-- ----------------------------------------------------------------------------

-- per-companion earnings (accrued vs paid)
create or replace view companion_earnings as
select c.id as companion_id, c.full_name,
       coalesce(sum(vp.amount) filter (where vp.status='accrued'),0) as pending,
       coalesce(sum(vp.amount) filter (where vp.status='paid'),0)    as paid,
       coalesce(sum(vp.amount),0) as lifetime
from companions c
left join visit_pay vp on vp.companion_id = c.id
group by c.id;

-- the headline finance position: revenue in vs companion cost out vs margin
create or replace view finance_overview as
with rev as (
  select coalesce(sum(total),0) as invoiced,
         coalesce(sum(amount_paid),0) as collected,
         coalesce(sum(total - amount_paid),0) as outstanding
  from invoices where status <> 'void'
),
cost as (
  select coalesce(sum(amount),0) as accrued,
         coalesce(sum(amount) filter (where status='paid'),0) as paid_out,
         coalesce(sum(amount) filter (where status='accrued'),0) as pending_out
  from visit_pay
)
select rev.invoiced, rev.collected, rev.outstanding,
       cost.accrued as companion_cost, cost.paid_out, cost.pending_out,
       (rev.invoiced - cost.accrued) as gross_margin,
       case when rev.invoiced > 0
            then round((rev.invoiced - cost.accrued) / rev.invoiced * 100, 1)
            else 0 end as margin_pct
from rev, cost;
