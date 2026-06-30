-- ============================================================
--  33_messages.sql  —  IN-PORTAL FAMILY MESSAGING
-- ============================================================
--  A lightweight message thread between a family (requester) and the
--  Companio team. Families send from their portal; the operator sees
--  and replies from the dashboard. No external dependency — works the
--  moment it's deployed.
-- ============================================================

do $$ begin
  create type message_sender as enum ('family','team');
exception when duplicate_object then null; end $$;

create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references requesters(id) on delete cascade,
  sender        message_sender not null,
  body          text not null,
  staff_name    text,                          -- which team member replied
  read_by_team  boolean not null default false,
  read_by_family boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_messages_requester on messages(requester_id, created_at);
create index if not exists idx_messages_unread on messages(read_by_team) where read_by_team = false;

alter table messages enable row level security;

-- staff: full access
drop policy if exists messages_staff on messages;
create policy messages_staff on messages for all
  using (exists(select 1 from staff where auth_user_id = auth.uid() and active))
  with check (exists(select 1 from staff where auth_user_id = auth.uid() and active));

-- family: read their own thread, and insert messages as 'family' only
drop policy if exists messages_family_read on messages;
create policy messages_family_read on messages for select
  using (requester_id in (select id from requesters where auth_user_id = auth.uid()));

drop policy if exists messages_family_send on messages;
create policy messages_family_send on messages for insert
  with check (
    sender = 'family'
    and requester_id in (select id from requesters where auth_user_id = auth.uid())
  );

-- family can mark team messages as read
drop policy if exists messages_family_update on messages;
create policy messages_family_update on messages for update
  using (requester_id in (select id from requesters where auth_user_id = auth.uid()))
  with check (requester_id in (select id from requesters where auth_user_id = auth.uid()));

-- Optional: email the team when a family sends a message (uses _send_email
-- from 08_email.sql; no-ops safely until email is configured).
create or replace function email_on_family_message() returns trigger as $$
declare r record;
begin
  if new.sender = 'family' then
    select full_name into r from requesters where id = new.requester_id;
    perform _send_email('family_message', jsonb_build_object(
      'family_name', coalesce(r.full_name,'A family'),
      'preview', left(new.body, 200)
    ));
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_email_family_message on messages;
create trigger t_email_family_message after insert on messages
  for each row execute function email_on_family_message();
