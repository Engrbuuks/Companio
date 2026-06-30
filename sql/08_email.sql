-- ============================================================================
-- COMPANIO ENGINE — EMAIL TRIGGERS  (08; run after 01–07 and after the
-- send-email Edge Function is deployed)
-- Uses Supabase's pg_net to POST to the Edge Function on key events:
--   · new enquiry        -> notify ops + acknowledge the family
--   · new visit note     -> email the note to the family
--   · invoice marked sent-> email the invoice to the requester
-- Safe to skip if you prefer to send email from the app layer instead.
-- ============================================================================

create extension if not exists pg_net;

-- Where the Edge Function lives + the key to call it.
-- Set these once (replace the values), they're read by the helper below.
--   select set_config('app.functions_url', 'https://YOURPROJECT.functions.supabase.co', false);
-- For persistence across sessions, store them in a tiny settings table:
create table if not exists app_settings (
  key text primary key,
  value text not null
);
-- INSERT your values once:
--   insert into app_settings(key,value) values
--     ('functions_url','https://YOURPROJECT.functions.supabase.co'),
--     ('service_key','YOUR-SERVICE-ROLE-KEY')
--   on conflict (key) do update set value = excluded.value;

create or replace function _send_email(p_type text, p_data jsonb) returns void as $$
declare
  v_base text;
  v_key  text;
begin
  select s.value into v_base from app_settings s where s.key = 'functions_url';
  select s.value into v_key  from app_settings s where s.key = 'service_key';
  if v_base is null then return; end if;  -- not configured; silently skip

  perform net.http_post(
    url     := v_base || '/send-email',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || coalesce(v_key,'')),
    body    := jsonb_build_object('type', p_type, 'data', p_data)
  );
end $$ language plpgsql security definer;

-- ----------------------------------------------------------------------------
-- 1. New enquiry -> notify ops + acknowledge family
--    (fires alongside the promotion trigger from 05_website_link.sql)
-- ----------------------------------------------------------------------------
create or replace function email_on_enquiry() returns trigger as $$
begin
  perform _send_email('enquiry_received', jsonb_build_object(
    'name', new.name, 'phone', new.phone, 'email', new.email,
    'city', new.city, 'message', new.message, 'matcher', new.matcher));
  if new.email is not null and position('@' in new.email::text) > 1 then
    perform _send_email('enquiry_ack', jsonb_build_object(
      'email', new.email, 'first_name', split_part(coalesce(new.name,''),' ',1)));
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_email_enquiry on enquiries;
create trigger t_email_enquiry after insert on enquiries
  for each row execute function email_on_enquiry();

-- ----------------------------------------------------------------------------
-- 2. New visit note shared with family -> email the family
-- ----------------------------------------------------------------------------
create or replace function email_on_note() returns trigger as $$
declare
  req_email citext; user_name text; comp_name text; when_txt text;
begin
  if not new.shared_with_family then return new; end if;
  select r.email, su.full_name, c.full_name, to_char(v.scheduled_at,'DD Mon YYYY')
    into req_email, user_name, comp_name, when_txt
  from visits v
  join bookings b on b.id = v.booking_id
  join requesters r on r.id = b.requester_id
  join service_users su on su.id = b.service_user_id
  left join companions c on c.id = new.companion_id
  where v.id = new.visit_id;

  if req_email is not null then
    perform _send_email('note_to_family', jsonb_build_object(
      'email', req_email, 'user_name', user_name, 'companion_name', comp_name,
      'when', when_txt, 'summary', new.summary));
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_email_note on visit_notes;
create trigger t_email_note after insert on visit_notes
  for each row execute function email_on_note();

-- ----------------------------------------------------------------------------
-- 3. Invoice status -> 'sent' -> email the requester
-- ----------------------------------------------------------------------------
create or replace function email_on_invoice() returns trigger as $$
declare req_email citext;
begin
  if new.status = 'sent' and (old.status is distinct from 'sent') then
    select email into req_email from requesters where id = new.requester_id;
    if req_email is not null then
      perform _send_email('invoice_sent', jsonb_build_object(
        'email', req_email, 'number', new.number,
        'total', to_char(new.total,'FM999990.00'), 'due_date', to_char(new.due_date,'DD Mon YYYY')));
    end if;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists t_email_invoice on invoices;
create trigger t_email_invoice after update on invoices
  for each row execute function email_on_invoice();
