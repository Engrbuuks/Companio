-- ============================================================================
-- COMPANIO ENGINE — LOGIN PROVISIONING (Model A: invite on approval)  (21)
-- No passwords are stored. When you approve someone, the dashboard calls the
-- provision-login Edge Function, which emails them a secure set-your-password
-- link and links the new auth account to their row. This just tracks state.
-- Run after 19.
-- ============================================================================

-- has an invite/login been created for this person yet?
alter table companions add column if not exists login_provisioned boolean not null default false;
alter table companions add column if not exists login_invited_at   timestamptz;
alter table requesters add column if not exists login_provisioned boolean not null default false;
alter table requesters add column if not exists login_invited_at   timestamptz;

-- mark a person as having been sent their login invite (called after the Edge
-- Function succeeds). Staff-only via RLS already on these tables.
create or replace function mark_login_invited(p_table text, p_id uuid)
returns void as $$
begin
  if p_table = 'companions' then
    update companions set login_provisioned = true, login_invited_at = now() where id = p_id;
  elsif p_table = 'requesters' then
    update requesters set login_provisioned = true, login_invited_at = now() where id = p_id;
  end if;
end $$ language plpgsql security definer;
