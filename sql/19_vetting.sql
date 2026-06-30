-- ============================================================================
-- COMPANIO ENGINE — VETTING CHECKLIST  (19; run after 01)
-- Per-applicant vetting checks you tick off as you complete them. These map to
-- the real UK clearance steps for someone visiting vulnerable adults.
-- ============================================================================

alter table companions add column if not exists chk_interview      boolean not null default false;  -- met them / interviewed
alter table companions add column if not exists chk_right_to_work   boolean not null default false;  -- gov.uk right-to-work confirmed
alter table companions add column if not exists chk_dbs_submitted   boolean not null default false;  -- DBS application sent
alter table companions add column if not exists chk_dbs_cleared     boolean not null default false;  -- DBS came back clear
alter table companions add column if not exists chk_references      boolean not null default false;  -- 2 references received
alter table companions add column if not exists chk_training        boolean not null default false;  -- induction / training done
alter table companions add column if not exists chk_notes           text;                            -- free notes on vetting

-- keep the existing dbs enum + references_ok in sync with the granular checks,
-- so the pipeline chips and the safety gate keep working unchanged.
create or replace function sync_vetting_flags() returns trigger as $$
begin
  -- references_ok mirrors the references checkbox
  new.references_ok := coalesce(new.chk_references, false);
  -- dbs status reflects the dbs checkboxes (cleared > submitted > none)
  if new.chk_dbs_cleared then
    new.dbs := 'cleared';
    if new.dbs_cleared_on is null then new.dbs_cleared_on := current_date; end if;
  elsif new.chk_dbs_submitted then
    new.dbs := 'submitted';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_sync_vetting on companions;
create trigger t_sync_vetting before insert or update on companions
  for each row execute function sync_vetting_flags();
