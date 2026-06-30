-- ============================================================================
-- COMPANIO ENGINE — FUNCTIONS (matching brain + ops helpers)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- match_score: how well does a companion fit a service user? (0-100 + reasons)
-- Weighting reflects what actually drives a good companionship match:
--   shared interests (35) · temperament (15) · service capability (20)
--   geography (20) · capacity/availability headroom (10)
-- ----------------------------------------------------------------------------
create or replace function match_score(p_user uuid, p_companion uuid)
returns table(score int, reasons text[]) as $$
declare
  u  service_users;
  c  companions;
  s  int := 0;
  r  text[] := '{}';
  shared text[];
  shared_n int;
  active_clients int;
  req_service service_kind;
begin
  select * into u from service_users where id = p_user;
  select * into c from companions where id = p_companion;
  if u is null or c is null then
    return query select 0, array['missing record']; return;
  end if;

  -- only active companions are matchable
  if c.status <> 'active' then
    return query select 0, array['companion not active']; return;
  end if;

  -- shared interests (35) — the single biggest signal
  shared := array(select unnest(u.interests) intersect select unnest(c.interests));
  shared_n := coalesce(array_length(shared,1),0);
  if shared_n >= 3 then s := s + 35; r := r || ('shares '||shared_n||' interests: '||array_to_string(shared,', '));
  elsif shared_n = 2 then s := s + 26; r := r || ('shares 2 interests: '||array_to_string(shared,', '));
  elsif shared_n = 1 then s := s + 16; r := r || ('shares an interest: '||shared[1]);
  else r := r || 'no shared interests yet'; end if;

  -- temperament fit (15)
  if u.temperament is not null and c.temperament is not null then
    if lower(u.temperament) = lower(c.temperament) then s := s + 15; r := r || ('temperament match: '||c.temperament);
    else s := s + 5; r := r || 'temperament differs'; end if;
  end if;

  -- service capability (20) — does the companion offer what's likely needed?
  -- derive likely need from any active booking for this user, else assume companionship
  select service into req_service from bookings
    where service_user_id = p_user and status in ('active','proposed','draft')
    order by created_at desc limit 1;
  req_service := coalesce(req_service,'companionship');
  if c.offers = 'both' or c.offers = req_service then s := s + 20; r := r || ('covers '||req_service::text);
  else r := r || ('does not offer '||req_service::text); end if;

  -- geography (20) — same postcode district (outward code) or same city
  if u.postcode is not null and c.postcode is not null
     and split_part(upper(u.postcode),' ',1) = split_part(upper(c.postcode),' ',1) then
    s := s + 20; r := r || 'same postcode district';
  elsif u.city is not null and c.city is not null and lower(u.city) = lower(c.city) then
    s := s + 12; r := r || 'same town';
  else r := r || 'further afield'; end if;

  -- capacity headroom (10) — fewer current clients = more attention
  select count(*) into active_clients from bookings
    where companion_id = p_companion and status = 'active';
  if active_clients < c.max_clients then
    s := s + greatest(0, 10 - active_clients);  -- more headroom scores higher
    r := r || (c.max_clients - active_clients || ' client slots free');
  else
    r := r || 'at capacity';
  end if;

  return query select least(s,100), r;
end $$ language plpgsql stable;

-- ----------------------------------------------------------------------------
-- suggest_matches: top N companions for a user, written into `matches`
-- ----------------------------------------------------------------------------
create or replace function suggest_matches(p_user uuid, p_limit int default 5)
returns setof matches as $$
declare rec record;
begin
  for rec in
    select c.id as companion_id, m.score, m.reasons
    from companions c
    cross join lateral match_score(p_user, c.id) m
    where c.status = 'active' and m.score > 0
    order by m.score desc
    limit p_limit
  loop
    insert into matches(service_user_id, companion_id, score, reasons, status)
    values (p_user, rec.companion_id, rec.score, rec.reasons, 'suggested')
    on conflict (service_user_id, companion_id)
      do update set score = excluded.score, reasons = excluded.reasons,
                    status = case when matches.status in ('accepted','declined')
                                  then matches.status else 'suggested' end;
  end loop;
  return query select * from matches where service_user_id = p_user order by score desc;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- generate_visits: roll a booking's frequency into scheduled visits for N weeks
-- ----------------------------------------------------------------------------
create or replace function generate_visits(p_booking uuid, p_weeks int default 4, p_first timestamptz default null)
returns int as $$
declare
  bk bookings;
  per_week int;
  start_ts timestamptz;
  wk int; v int := 0; i int;
begin
  select * into bk from bookings where id = p_booking;
  if bk is null then return 0; end if;
  per_week := case bk.frequency
    when 'weekly' then 1 when 'twice_weekly' then 2
    when 'most_days' then 5 else 1 end;
  start_ts := coalesce(p_first, date_trunc('week', now()) + interval '1 week' + time '10:00');
  for wk in 0..(p_weeks-1) loop
    for i in 0..(per_week-1) loop
      insert into visits(booking_id, companion_id, scheduled_at, length_hrs, status)
      values (p_booking, bk.companion_id,
              start_ts + (wk||' weeks')::interval + (i*2||' days')::interval,
              bk.visit_length_hrs, 'scheduled');
      v := v + 1;
    end loop;
  end loop;
  return v;
end $$ language plpgsql;

-- ----------------------------------------------------------------------------
-- companion_load: live view of how full each active companion's roster is
-- ----------------------------------------------------------------------------
create or replace view companion_load as
select c.id, c.full_name, c.status, c.max_clients,
       count(b.id) filter (where b.status='active') as active_clients,
       c.max_clients - count(b.id) filter (where b.status='active') as slots_free
from companions c
left join bookings b on b.companion_id = c.id
group by c.id;
