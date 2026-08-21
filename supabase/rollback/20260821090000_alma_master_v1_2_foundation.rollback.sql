-- Explicit rollback companion for 20260821090000_alma_master_v1_2_foundation.sql.
-- Legacy ALMA v1 tables are intentionally not touched.

drop table if exists public.alma_v2_legacy_unclassified cascade;
drop table if exists public.alma_v2_sync_state cascade;
drop table if exists public.alma_v2_experiments cascade;
drop table if exists public.alma_v2_personal_tools cascade;
drop table if exists public.alma_v2_recommendations cascade;
drop table if exists public.alma_v2_forecasts cascade;
drop table if exists public.alma_v2_output_feed cascade;
drop table if exists public.alma_v2_input_requests cascade;
drop table if exists public.alma_v2_research_quests cascade;
drop table if exists public.alma_v2_patterns cascade;
drop table if exists public.alma_v2_dynamic_features cascade;
drop table if exists public.alma_v2_baselines cascade;
drop table if exists public.alma_v2_events cascade;
drop table if exists public.alma_v2_planned_events cascade;
drop table if exists public.alma_v2_context_periods cascade;
drop table if exists public.alma_v2_symptom_episodes cascade;
drop table if exists public.alma_v2_observations cascade;
drop table if exists public.alma_v2_entity_aliases cascade;
drop table if exists public.alma_v2_entities cascade;
drop table if exists public.alma_v2_profiles cascade;
drop function if exists public.alma_v2_protect_output_feed_content();
drop function if exists public.alma_v2_touch_updated_at();
