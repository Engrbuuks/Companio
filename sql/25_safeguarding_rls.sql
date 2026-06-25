-- ============================================================================
-- COMPANIO ENGINE — 25 · SAFEGUARDING RLS + RAISE HELPER + FAMILY MATCH VIEW
-- Run after 24. Adds:
--   · RLS for safeguarding_concerns (staff manage; companion raises/reads own)
--   · raise_concern() so the companion portal can log a concern safely
--   · my_companion() RPC for the family portal to see WHO their companion is
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RLS: safeguarding is sensitive. Staff see/triage everything. A companion
-- may INSERT a concern and READ the concerns they themselves raised. Families
-- never see raw safeguarding records (operators decide what to communicate).
-- ---------------------------------------------------------------------------
drop policy if exists sg_staff_all on safeguarding_concerns;
create policy sg_staff_all on safeguarding_concerns
  for all using (is_staff()) with check (is_staff());

drop policy if exists sg_comp_insert on safeguarding_concerns;
create policy sg_comp_insert on safeguarding_concerns
  for insert with check (companion_id = my_companion_id());

drop policy if exists sg_comp_read_own on safeguarding_concerns;
create policy sg_comp_read_own on safeguarding_concerns
  for select using (companion_id = my_companion_id());

-- ---------------------------------------------------------------------------
-- raise_concern: companion portal calls this to log a welfare concern.
-- security definer so the insert is clean, but we force companion_id to the
-- caller's own companion row — a companion can never raise "as" someone else.
-- ---------------------------------------------------------------------------
create or replace function raise_concern(
  p_service_user uuid,
  p_category     safeguarding_category,
  p_severity     int,
  p_description  text,
  p_visit        uuid default null
) returns uuid as $$
declare
  cid uuid := my_companion_id();
  new_id uuid;
begin
  if cid is null then
    raise exception 'Only a signed-in companion can raise a concern';
  end if;
  insert into safeguarding_concerns
    (service_user_id, companion_id, visit_id, category, severity, description)
  values
    (p_service_user, cid, p_visit, p_category, greatest(1,least(3,coalesce(p_severity,2))), p_description)
  returning id into new_id;
  return new_id;
end $$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- my_companion: the family portal asks "who is looking after my loved one?"
-- Operator decides the match (an active booking's companion, or an
-- introduced/accepted `matches` row); the family is simply informed. Returns
-- only friendly, public-safe details — never private vetting/finance fields.
-- ---------------------------------------------------------------------------
create or replace function my_companion()
returns table(
  service_user_id uuid,
  service_user_name text,
  companion_id    uuid,
  companion_name  text,
  companion_bio   text,
  companion_photo text,
  shared_interests text[],
  since           date
) as $$
  with mine as (
    select su.id as su_id, su.full_name as su_name, su.interests as su_interests
    from service_users su
    where su.requester_id = my_requester_id()
  )
  select
    mine.su_id,
    mine.su_name,
    c.id,
    c.full_name,
    c.bio,
    c.photo_url,
    array(select unnest(mine.su_interests) intersect select unnest(c.interests)),
    coalesce(b.start_date, m.created_at::date)
  from mine
  -- prefer an active booking's companion; fall back to an accepted match
  left join lateral (
    select b.companion_id, b.start_date
    from bookings b
    where b.service_user_id = mine.su_id and b.status = 'active'
    order by b.created_at desc limit 1
  ) b on true
  left join lateral (
    select m.companion_id, m.created_at
    from matches m
    where m.service_user_id = mine.su_id and m.status in ('introduced','accepted')
    order by m.created_at desc limit 1
  ) m on true
  join companions c
    on c.id = coalesce(b.companion_id, m.companion_id)
  where c.id is not null;
$$ language sql stable security definer;

grant execute on function raise_concern(uuid, safeguarding_category, int, text, uuid) to authenticated;
grant execute on function my_companion() to authenticated;
