-- ============================================================
--  31_interviews.sql  —  COMPANION INTERVIEW SCHEDULER
-- ============================================================
--  Operator-side interview booking for companion applicants.
--  You book a slot, pick method + who conducts it, and (once the
--  email pipeline is live) the applicant is emailed the details.
-- ============================================================

do $$ begin
  create type interview_method as enum ('video','phone','in_person');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_status as enum ('scheduled','completed','no_show','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists interviews (
  id            uuid primary key default gen_random_uuid(),
  companion_id  uuid not null references companions(id) on delete cascade,
  scheduled_at  timestamptz not null,
  method        interview_method not null default 'video',
  conducted_by  text,                          -- who runs it (you / UK person name)
  location      text,                           -- video link, phone note, or address
  status        interview_status not null default 'scheduled',
  notes         text,                           -- private prep / outcome notes
  outcome       text,                           -- short outcome after the interview
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_interviews_companion on interviews(companion_id);
create index if not exists idx_interviews_when on interviews(scheduled_at);

-- RLS: staff only
alter table interviews enable row level security;
drop policy if exists interviews_staff on interviews;
create policy interviews_staff on interviews for all
  using (exists(select 1 from staff where auth_user_id = auth.uid() and active))
  with check (exists(select 1 from staff where auth_user_id = auth.uid() and active));

-- Email the applicant their interview details when one is booked.
-- Uses the same _send_email helper as enquiries (08_email.sql). Safe to
-- run before email is live — it just no-ops until functions_url is set.
create or replace function email_on_interview() returns trigger as $$
declare c record;
begin
  select full_name, email into c from companions where id = new.companion_id;
  if c.email is not null and position('@' in c.email) > 1 then
    perform _send_email('interview_scheduled', jsonb_build_object(
      'email', c.email,
      'first_name', split_part(coalesce(c.full_name,''),' ',1),
      'scheduled_at', to_char(new.scheduled_at, 'Day DD Mon YYYY, HH24:MI'),
      'method', new.method::text,
      'location', coalesce(new.location,'')
    ));
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_email_interview on interviews;
create trigger t_email_interview after insert on interviews
  for each row execute function email_on_interview();
