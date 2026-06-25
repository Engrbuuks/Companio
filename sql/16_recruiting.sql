-- ============================================================================
-- COMPANIO ENGINE — RECRUITING: SOURCE + FOLLOW-UP  (16; run after 01)
-- Adds the fields the pipeline needs to track where applicants come from
-- and who's waiting on a follow-up.
-- ============================================================================

alter table companions add column if not exists source text;            -- website, referral, flyer, facebook, word_of_mouth, other
alter table companions add column if not exists last_contact_at timestamptz;  -- when you last spoke to them
alter table companions add column if not exists next_action text;        -- e.g. "chase DBS", "call back Friday"
alter table companions add column if not exists next_action_due date;     -- when that action is due
alter table companions add column if not exists stage_changed_at timestamptz not null default now();

-- keep stage_changed_at fresh whenever status changes (so we can see "stuck too long")
create or replace function touch_stage_changed() returns trigger as $$
begin
  if new.status is distinct from old.status then
    new.stage_changed_at := now();
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_companion_stage on companions;
create trigger t_companion_stage before update on companions
  for each row execute function touch_stage_changed();
