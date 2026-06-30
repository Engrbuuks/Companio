-- ============================================================================
-- COMPANIO ENGINE — AI ASSIST  (13; run after 12)
-- Registers the AI feature flag. The AI layer is DORMANT until:
--   (1) you deploy the ai-assist Edge Function,
--   (2) set ANTHROPIC_API_KEY as a function secret, and
--   (3) turn feature.ai 'on' in Settings.
-- Until then every AI button no-ops with a friendly "not enabled" message.
-- ============================================================================

insert into app_settings(key, value) values ('feature.ai', 'off')
on conflict (key) do nothing;

-- store the ai-assist function URL once (same project functions domain):
--   insert into app_settings(key,value) values
--     ('ai_functions_url','https://YOURPROJECT.functions.supabase.co')
--   on conflict (key) do update set value = excluded.value;

-- (feature_on() and set_feature() already exist from 12_features.sql,
--  so the Settings panel can flip 'ai' on/off with no further changes.)
