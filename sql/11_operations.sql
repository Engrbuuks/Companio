-- ============================================================================
-- COMPANIO ENGINE — OPERATIONS  (11; run after 09)
-- The messy real-world cases: cancellations, reschedules, reassignment,
-- and a single "what needs my attention" query that powers the alerts panel.
-- ============================================================================

-- Optional reason/audit columns on visits (safe if re-run)
alter table visits add column if not exists cancel_reason text;
alter table visits add column if not exists reassigned_from uuid;   -- prior companion
alter table visits add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- cancel_visit — cancel a scheduled visit. If a companion was assigned and the
-- cancellation is late/charged, optionally still accrue (kept simple: no pay,
-- no bill on cancel). Reverses any accrual if one somehow exists.
-- ----------------------------------------------------------------------------
create or replace function cancel_visit(p_visit uuid, p_reason text default null, p_no_access boolean default false)
returns void as $$
declare v visits;
begin
  select * into v from visits where id = p_visit;
  if v is null then raise exception 'visit % not found', p_visit; end if;
  if v.status = 'completed' then raise exception 'cannot cancel a completed visit'; end if;

  update visits
     set status = (case when p_no_access then 'no_access' else 'cancelled' end)::visit_status,
         cancel_reason = p_reason, updated_at = now()
   where id = p_visit;

  -- void any accrued (unpaid) pay for this visit
  update visit_pay set status = 'void'
   where visit_id = p_visit and status = 'accrued';
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- reschedule_visit — move a scheduled visit to a new time
-- ----------------------------------------------------------------------------
create or replace function reschedule_visit(p_visit uuid, p_new_at timestamptz)
returns void as $$
begin
  update visits set scheduled_at = p_new_at, updated_at = now()
   where id = p_visit and status in ('scheduled','no_access');
  if not found then raise exception 'visit % not reschedulable', p_visit; end if;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- reassign_visit — give a scheduled visit to a different companion
--   (records who it came from; pay will accrue to the NEW companion on completion)
-- ----------------------------------------------------------------------------
create or replace function reassign_visit(p_visit uuid, p_new_companion uuid)
returns void as $$
declare v visits;
begin
  select * into v from visits where id = p_visit;
  if v is null then raise exception 'visit % not found', p_visit; end if;
  if v.status = 'completed' then raise exception 'cannot reassign a completed visit'; end if;

  update visits
     set reassigned_from = v.companion_id,
         companion_id = p_new_companion,
         status = 'scheduled',
         updated_at = now()
   where id = p_visit;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- reassign_booking — change the standing companion on a booking AND move all
-- its future scheduled visits to the new companion (the common real case when
-- a companion leaves or a match isn't working).
-- ----------------------------------------------------------------------------
create or replace function reassign_booking(p_booking uuid, p_new_companion uuid)
returns int as $$
declare n int;
begin
  update bookings set companion_id = p_new_companion, updated_at = now() where id = p_booking;
  update visits
     set reassigned_from = companion_id, companion_id = p_new_companion, updated_at = now()
   where booking_id = p_booking and status = 'scheduled' and scheduled_at >= now();
  get diagnostics n = row_count;
  return n;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- action_items — the single "what needs attention" feed for the dashboard.
-- Returns a typed list, most urgent first. Each row: kind, severity, label, ref.
-- ----------------------------------------------------------------------------
create or replace function action_items()
returns table(kind text, severity text, label text, ref uuid, when_at timestamptz) as $$
begin
  return query
  select * from (
  -- completed visits with no note written yet
  select 'note_due'::text as kind, 'high'::text as severity,
         su.full_name || ' — visit on ' || to_char(v.scheduled_at,'DD Mon') || ' needs a note to family' as label,
         v.id as ref, v.scheduled_at as when_at
  from visits v
  join bookings b on b.id = v.booking_id
  join service_users su on su.id = b.service_user_id
  where v.status = 'completed'
    and not exists (select 1 from visit_notes n where n.visit_id = v.id)

  union all
  select 'invoice_overdue', 'high',
         coalesce(i.number,'Invoice') || ' is overdue (£' || to_char(i.total - i.amount_paid,'FM999990.00') || ' due)',
         i.id, i.due_date::timestamptz
  from invoices i
  where i.status in ('sent','overdue') and i.due_date < current_date and (i.total - i.amount_paid) > 0

  union all
  select 'vetting', 'medium',
         c.full_name || ' is in vetting (DBS: ' || c.dbs || ')',
         c.id, c.applied_at
  from companions c
  where c.status in ('applicant','vetting')

  union all
  select 'dbs_expiring', 'medium',
         c.full_name || ' DBS expires ' || to_char(c.dbs_cleared_on + interval '3 years','DD Mon YYYY'),
         c.id, (c.dbs_cleared_on + interval '3 years')::timestamptz
  from companions c
  where c.dbs = 'cleared' and c.dbs_cleared_on is not null
    and c.dbs_cleared_on + interval '3 years' < current_date + interval '60 days'

  union all
  select 'unassigned', 'high',
         su.full_name || ' has an active booking with no companion assigned',
         b.id, b.created_at
  from bookings b
  join service_users su on su.id = b.service_user_id
  where b.status = 'active' and b.companion_id is null
  ) items
  order by case items.severity when 'high' then 1 when 'medium' then 2 else 3 end, items.when_at;
end $$ language plpgsql stable;
