-- ============================================================================
-- COMPANIO ENGINE — 23 · CLIENT SUCCESS PLAN
-- Richer "know the person, not the booking" fields on service_users.
-- These deepen the client profile and feed the matcher (music/routines).
-- Safe to re-run.
-- ============================================================================

alter table service_users add column if not exists fav_music      text;   -- favourite music / artists / genres
alter table service_users add column if not exists routines       text;   -- daily rhythms (e.g. "tea at 4, nap after lunch")
alter table service_users add column if not exists dietary        text;   -- dietary needs & preferences
alter table service_users add column if not exists birthday       date;   -- so we never miss it
alter table service_users add column if not exists important_dates text;  -- anniversaries, memorial dates, milestones
alter table service_users add column if not exists family_details text;   -- key people, names, who visits, who to call
alter table service_users add column if not exists conversation_starters text; -- "ask about her years teaching in Leeds"

comment on column service_users.fav_music is 'Feeds the Success Plan + can boost matching when a companion shares the taste';

-- A friendly photo for the companion, shown to the family in their portal
-- ("here's who's coming to see Mum"). Public-safe; optional.
alter table companions add column if not exists photo_url text;
