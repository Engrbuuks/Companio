-- ============================================================================
-- COMPANIO ENGINE — EDITABLE DASHBOARD TEXT  (14; run after 12)
-- Lets operators edit headings/descriptions live; overrides persist here.
-- Stored in app_settings as 'text.<key>'. Empty value = revert to default.
-- ============================================================================

create or replace function set_text(p_key text, p_value text) returns void as $$
begin
  if p_value is null or p_value = '' then
    delete from app_settings where key = 'text.' || p_key;
  else
    insert into app_settings(key, value) values ('text.' || p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$ language plpgsql security definer;
