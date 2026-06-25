-- ============================================================================
-- COMPANIO ENGINE — THEME / SETTINGS WRITER  (17; run after 12)
-- A generic setter the dashboard uses to persist theme overrides
-- (theme.aubergine, theme.wheat, theme.serif, theme.logo, …) and any other
-- 'key = value' app setting. Empty value deletes the row (reverts to default).
-- ============================================================================

create or replace function set_setting(p_key text, p_value text) returns void as $$
begin
  if p_value is null or p_value = '' then
    delete from app_settings where key = p_key;
  else
    insert into app_settings(key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$ language plpgsql security definer;
