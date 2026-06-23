-- ============================================================================
-- COMPANIO ENGINE — WEBSITE LINK  (run after 01–03; 05 of the set)
-- The website posts every submission into `enquiries` (a raw inbox).
-- A trigger then PROMOTES each row into the proper engine tables:
--   · a customer enquiry  -> requesters (+ a draft service_users row)
--   · a companion applicant -> companions (status 'applicant')
-- Nothing is ever lost: the raw enquiry stays in `enquiries` for audit,
-- and `promoted_*` columns record what it became.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The inbox the website writes to (matches the WordPress bridge payload)
-- ----------------------------------------------------------------------------
create table if not exists enquiries (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  phone         text,
  email         citext,
  relationship  text,            -- 'Companion applicant' = supply; else a customer
  city          text,
  message       text,
  matcher       text,            -- the matcher summary captured on the site
  source        text default 'website',
  -- promotion bookkeeping
  promoted_kind text,            -- 'requester' | 'companion' | null (unprocessed)
  promoted_id   uuid,            -- the row it became
  created_at    timestamptz not null default now()
);
create index if not exists idx_enquiries_unpromoted on enquiries(created_at) where promoted_kind is null;

-- the website uses the service key, but lock the table down for everyone else
alter table enquiries enable row level security;
drop policy if exists enq_staff_all on enquiries;
create policy enq_staff_all on enquiries for all using (is_staff()) with check (is_staff());

-- ----------------------------------------------------------------------------
-- 2. Promotion — core logic in one function, reused by trigger AND backfill.
--    Takes an enquiry id, creates the engine records, stamps promoted_* .
-- ----------------------------------------------------------------------------
create or replace function promote_one(p_enquiry uuid) returns void as $$
declare
  e enquiries;
  is_applicant boolean;
  new_req uuid;
  new_cid uuid;
  new_user_name text;
  for_hint text;
begin
  select * into e from enquiries where id = p_enquiry;
  if e is null or e.promoted_kind is not null then return; end if;

  is_applicant := lower(coalesce(e.relationship,'')) like '%applicant%'
               or lower(coalesce(e.relationship,'')) like '%companion%';

  -- ---------- SUPPLY: companion application ----------
  if is_applicant then
    insert into companions(full_name, email, phone, city, status, offers, notes)
    values (
      coalesce(nullif(e.name,''),'New applicant'),
      coalesce(e.email, ('applicant+'||left(e.id::text,8)||'@noemail.companio')::citext),
      e.phone, e.city, 'applicant', 'both', coalesce(e.message,'')
    )
    on conflict (email) do update set phone = excluded.phone, city = excluded.city
    returning id into new_cid;
    update enquiries set promoted_kind='companion', promoted_id=new_cid where id = e.id;
    return;
  end if;

  -- ---------- DEMAND: customer enquiry ----------
  insert into requesters(full_name, email, phone, status, source, matcher_notes)
  values (
    coalesce(nullif(e.name,''),'New enquiry'),
    coalesce(e.email, ('enquiry+'||left(e.id::text,8)||'@noemail.companio')::citext),
    e.phone, 'lead', coalesce(e.source,'website'), e.matcher
  )
  on conflict (email) do update set phone = excluded.phone
  returning id into new_req;

  -- pull a "For: …" hint out of the matcher summary if present
  for_hint := (regexp_match(coalesce(e.matcher,''), 'For:\s*([^·]+)', 'i'))[1];
  new_user_name := case when for_hint is not null and btrim(for_hint) <> ''
                        then 'Loved one ('||btrim(for_hint)||')'
                        else 'Loved one (to confirm)' end;

  insert into service_users(requester_id, full_name, relationship, city, notes)
  values (
    new_req, new_user_name,
    (case lower(coalesce(e.relationship,''))
      when 'parent' then 'adult_child' when 'spouse' then 'spouse'
      when 'myself' then 'self' else 'adult_child' end)::relationship_kind,
    e.city,
    coalesce(e.message,'') || case when e.matcher is not null then E'\n\nFrom matcher: '||e.matcher else '' end
  );

  update enquiries set promoted_kind='requester', promoted_id=new_req where id = e.id;
end $$ language plpgsql;

-- trigger wrapper: after insert, promote the new row
create or replace function trg_promote_enquiry() returns trigger as $$
begin
  perform promote_one(new.id);
  return null;  -- AFTER trigger
end $$ language plpgsql;

drop trigger if exists t_promote_enquiry on enquiries;
create trigger t_promote_enquiry
  after insert on enquiries
  for each row execute function trg_promote_enquiry();

-- ----------------------------------------------------------------------------
-- 3. Backfill — promote any enquiries that predate the trigger
-- ----------------------------------------------------------------------------
create or replace function promote_backlog() returns int as $$
declare r record; n int := 0;
begin
  for r in select id from enquiries where promoted_kind is null order by created_at loop
    perform promote_one(r.id);
    n := n + 1;
  end loop;
  return n;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- 4. A tidy view of the inbox for the dashboard
-- ----------------------------------------------------------------------------
create or replace view enquiry_inbox as
select e.id, e.created_at, e.name, e.phone, e.email,
       case when e.promoted_kind='companion' then 'Companion applicant'
            else coalesce(nullif(e.relationship,''),'Enquiry') end as kind,
       e.promoted_kind, e.promoted_id, e.matcher, e.city, e.message
from enquiries e
order by e.created_at desc;
