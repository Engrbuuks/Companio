-- ============================================================
--  32_overtime.sql  —  VISIT OVERTIME CAPTURE
-- ============================================================
--  A membership visit has a PLANNED length (length_hrs). Real visits
--  sometimes run over. We capture the actual time three ways
--  (check-in/out, a "ran over" tap, or operator entry), surface the
--  overtime for review, and let the operator decide per-instance to
--  bill it, waive it, or flag a pattern — never auto-charged, so the
--  "no clock-watching" premium feel is protected.
-- ============================================================

-- actual time + overtime decision on each visit
alter table visits add column if not exists checked_in_at  timestamptz;
alter table visits add column if not exists checked_out_at timestamptz;
alter table visits add column if not exists actual_hrs     numeric(4,2);   -- actual time spent (computed or entered)
alter table visits add column if not exists overtime_hrs   numeric(4,2) default 0;  -- actual - planned, when positive
alter table visits add column if not exists overtime_reason text;          -- why it ran over

do $$ begin
  create type overtime_decision as enum ('pending','billed','waived','upgrade_flag');
exception when duplicate_object then null; end $$;

alter table visits add column if not exists overtime_status overtime_decision default 'pending';
alter table visits add column if not exists overtime_invoice_id uuid references invoices(id) on delete set null;

-- helper: recompute overtime from actual vs planned, rounding to nearest 0.25h.
-- Small overruns under a tolerance (default 0.25h = 15 min) are treated as
-- zero overtime — generosity that reinforces the premium, no-meter feel.
create or replace function recompute_overtime(p_visit uuid, p_tolerance numeric default 0.25)
returns void as $$
declare v record; act numeric; ot numeric;
begin
  select * into v from visits where id = p_visit;
  if v is null then return; end if;
  -- prefer explicit actual_hrs; else derive from check in/out
  if v.actual_hrs is not null then
    act := v.actual_hrs;
  elsif v.checked_in_at is not null and v.checked_out_at is not null then
    act := round(extract(epoch from (v.checked_out_at - v.checked_in_at))/3600.0 * 4) / 4.0;
  else
    return; -- nothing to compute yet
  end if;
  ot := act - coalesce(v.length_hrs, 0);
  if ot <= p_tolerance then ot := 0; end if;
  update visits
     set actual_hrs = act,
         overtime_hrs = greatest(ot, 0)
   where id = p_visit;
end $$ language plpgsql;

-- index for the "overtime needing a decision" operator view
create index if not exists idx_visits_overtime on visits(overtime_status) where overtime_hrs > 0;
