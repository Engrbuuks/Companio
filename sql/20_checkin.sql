-- ============================================================================
-- COMPANIO ENGINE — VISIT CHECK-IN / CHECK-OUT  (20; run after 09)
-- The companion taps "arrived" and "left"; families see it live; you get
-- alerted if a visit doesn't start on time. This is the core-promise cluster:
-- families knowing their relative was visited, on time, by the same person.
-- ============================================================================

alter table visits add column if not exists checked_in_at  timestamptz;
alter table visits add column if not exists checked_out_at timestamptz;

-- Companion checks in (arrived). Safe to call once; idempotent.
create or replace function check_in_visit(p_visit uuid) returns void as $$
begin
  update visits
     set checked_in_at = coalesce(checked_in_at, now())
   where id = p_visit;
end $$ language plpgsql security definer;

-- Companion checks out (left). Marks the visit completed and accrues pay
-- via the existing complete_visit() spine, so finance stays correct.
create or replace function check_out_visit(p_visit uuid) returns void as $$
begin
  update visits
     set checked_out_at = coalesce(checked_out_at, now())
   where id = p_visit;
  -- reuse the existing completion logic (idempotent) to accrue pay + mark done
  perform complete_visit(p_visit);
end $$ language plpgsql security definer;

-- Missed-visit feed: scheduled visits whose start time has passed with no
-- check-in. Powers the operator alert. "grace" = minutes of leeway.
create or replace function missed_visits(p_grace int default 20)
returns table(visit_id uuid, scheduled_at timestamptz, companion text, service_user text, minutes_late int) as $$
  select v.id,
         v.scheduled_at,
         c.full_name,
         su.full_name,
         (extract(epoch from (now() - v.scheduled_at))/60)::int
    from visits v
    join bookings b      on b.id = v.booking_id
    left join companions c     on c.id = v.companion_id
    left join service_users su on su.id = b.service_user_id
   where v.status = 'scheduled'
     and v.checked_in_at is null
     and v.scheduled_at < now() - make_interval(mins => p_grace)
   order by v.scheduled_at asc;
$$ language sql stable security definer;

-- Next upcoming visit per service user (for the family reassurance line).
create or replace function next_visit_for(p_user uuid)
returns table(scheduled_at timestamptz, companion text) as $$
  select v.scheduled_at, c.full_name
    from visits v
    join bookings b on b.id = v.booking_id
    left join companions c on c.id = v.companion_id
   where b.service_user_id = p_user
     and v.status = 'scheduled'
     and v.scheduled_at >= now()
   order by v.scheduled_at asc
   limit 1;
$$ language sql stable security definer;
