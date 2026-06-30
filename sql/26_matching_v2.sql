-- ============================================================================
-- COMPANIO ENGINE — 26 · MATCHING v2 (music affinity)
-- Adds a gentle bonus when a companion's interests echo the client's
-- favourite music — a real conversational icebreaker for companionship.
-- Keeps the original weighting; music is a tiebreaker (+ up to 6), still
-- capped at 100. Replaces match_score in place (suggest_matches unchanged).
-- Safe to re-run.
-- ============================================================================

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
  music_lc text;
begin
  select * into u from service_users where id = p_user;
  select * into c from companions where id = p_companion;
  if u is null or c is null then
    return query select 0, array['missing record']; return;
  end if;

  if c.status <> 'active' then
    return query select 0, array['companion not active']; return;
  end if;

  -- shared interests (35)
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

  -- service capability (20)
  select service into req_service from bookings
    where service_user_id = p_user and status in ('active','proposed','draft')
    order by created_at desc limit 1;
  req_service := coalesce(req_service,'companionship');
  if c.offers = 'both' or c.offers = req_service then s := s + 20; r := r || ('covers '||req_service::text);
  else r := r || ('does not offer '||req_service::text); end if;

  -- geography (20)
  if u.postcode is not null and c.postcode is not null
     and split_part(upper(u.postcode),' ',1) = split_part(upper(c.postcode),' ',1) then
    s := s + 20; r := r || 'same postcode district';
  elsif u.city is not null and c.city is not null and lower(u.city) = lower(c.city) then
    s := s + 12; r := r || 'same town';
  else r := r || 'further afield'; end if;

  -- capacity headroom (10)
  select count(*) into active_clients from bookings
    where companion_id = p_companion and status = 'active';
  if active_clients < c.max_clients then
    s := s + greatest(0, 10 - active_clients);
    r := r || (c.max_clients - active_clients || ' client slots free');
  else
    r := r || 'at capacity';
  end if;

  -- NEW: music affinity (up to +6) — does any of the companion's interests
  -- appear in the client's favourite music? A warm conversational hook.
  if u.fav_music is not null and length(trim(u.fav_music)) > 0
     and coalesce(array_length(c.interests,1),0) > 0 then
    music_lc := lower(u.fav_music);
    if exists (select 1 from unnest(c.interests) i where music_lc like '%'||lower(i)||'%') then
      s := s + 6; r := r || 'shares a love of their kind of music';
    end if;
  end if;

  return query select least(s,100), r;
end $$ language plpgsql stable;
