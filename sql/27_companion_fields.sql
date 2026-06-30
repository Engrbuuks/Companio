-- ============================================================================
-- COMPANIO ENGINE — 27 · RICHER COMPANION APPLICANTS
-- New columns captured by the redesigned "Become a Companion" form, so the
-- richer answers land in real, filterable columns — not buried in the bio.
-- Safe to re-run.
-- ============================================================================

-- when they can work — multi-select stored as an array
alter table companions add column if not exists availability  text[] not null default '{}';
-- right-to-work in the UK (self-declared at apply; verified later in vetting)
alter table companions add column if not exists right_to_work boolean;
-- age band (we only need "are they an adult" + a rough band, not DOB)
alter table companions add column if not exists age_band      text;   -- '18-24','25-34','35-44','45-54','55-64','65+'
-- music they love — a genuine companionship icebreaker + feeds matching
alter table companions add column if not exists fav_music     text;
-- how they heard about Companio (recruiting channel insight)
alter table companions add column if not exists heard_about   text;

comment on column companions.availability is 'Multi-select: weekday_morning, weekday_afternoon, evening, weekend, flexible';
comment on column companions.right_to_work is 'Self-declared at application; confirmed during vetting (chk_right_to_work)';
