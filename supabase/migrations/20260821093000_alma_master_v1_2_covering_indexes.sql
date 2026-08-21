-- Cover foreign keys and common user-scoped queries reported by the
-- Supabase performance advisor after the V1.2 foundation migration.

create index if not exists alma_v2_observations_supersedes_idx
  on public.alma_v2_observations (supersedes_observation_id)
  where supersedes_observation_id is not null;

create index if not exists alma_v2_events_planned_source_idx
  on public.alma_v2_events (converted_from_planned_event_id)
  where converted_from_planned_event_id is not null;

create index if not exists alma_v2_patterns_parent_idx
  on public.alma_v2_patterns (parent_pattern_id)
  where parent_pattern_id is not null;

create index if not exists alma_v2_requests_quest_idx
  on public.alma_v2_input_requests (related_quest_id)
  where related_quest_id is not null;

create index if not exists alma_v2_requests_answer_idx
  on public.alma_v2_input_requests (answer_observation_id)
  where answer_observation_id is not null;

create index if not exists alma_v2_feed_pattern_idx
  on public.alma_v2_output_feed (related_pattern_id)
  where related_pattern_id is not null;

create index if not exists alma_v2_feed_quest_idx
  on public.alma_v2_output_feed (related_quest_id)
  where related_quest_id is not null;

create index if not exists alma_v2_feed_supersedes_idx
  on public.alma_v2_output_feed (supersedes_insight_id)
  where supersedes_insight_id is not null;

create index if not exists alma_v2_recommendations_event_idx
  on public.alma_v2_recommendations (performed_event_id)
  where performed_event_id is not null;

create index if not exists alma_v2_personal_tools_user_status_idx
  on public.alma_v2_personal_tools (user_id, status)
  where deleted_at is null;

create index if not exists alma_v2_experiments_user_status_idx
  on public.alma_v2_experiments (user_id, status, period_start desc)
  where deleted_at is null;
