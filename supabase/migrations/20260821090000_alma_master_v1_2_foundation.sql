-- ALMA Master Architecture V1.2 canonical foundation.
-- Append-only compatibility migration: legacy tables remain readable and untouched.

create table if not exists public.alma_v2_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Вы',
  timezone text not null default 'UTC',
  preferences jsonb not null default '{}'::jsonb,
  location_privacy text not null default 'approximate' check (location_privacy in ('off', 'approximate', 'precise')),
  population_opt_in boolean not null default false,
  schema_version integer not null default 2 check (schema_version >= 2),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_key text not null check (char_length(canonical_key) between 1 and 120),
  canonical_label text not null check (char_length(canonical_label) between 1 and 160),
  user_label text check (char_length(user_label) <= 160),
  kind text not null check (kind in ('metric', 'state', 'symptom', 'activity', 'social_event', 'intake', 'cycle_event', 'physiology_signal', 'natural_signal', 'digital_signal', 'context', 'derived_metric')),
  domain text not null check (domain in ('internal', 'activity', 'social', 'nutrition', 'cycle', 'physiology', 'natural_environment', 'digital_environment', 'life_context')),
  custom boolean not null default true,
  registry_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, canonical_key)
);

create table if not exists public.alma_v2_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_definition_id text not null check (char_length(entity_definition_id) between 1 and 160),
  normalized_alias text not null check (char_length(normalized_alias) between 1 and 160),
  display_alias text not null check (char_length(display_alias) between 1 and 160),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected')),
  confirmation_required boolean not null default true,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, normalized_alias)
);

create table if not exists public.alma_v2_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  definition_id text not null check (char_length(definition_id) between 1 and 160),
  occurred_at timestamptz,
  occurred_end_at timestamptz,
  local_date date not null,
  timezone text not null,
  time_precision text not null check (time_precision in ('date_only', 'day_part', 'approximate_time', 'exact_time')),
  recorded_at timestamptz not null default now(),
  value jsonb not null,
  raw_value jsonb,
  unit text,
  source_id text not null,
  source_record_id text,
  source_device_id text,
  adapter_version text,
  epistemic_status text not null check (epistemic_status in ('measured', 'user_confirmed', 'inferred', 'predicted', 'planned')),
  presence text check (presence in ('present', 'confirmed_absent', 'unknown')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  supersedes_observation_id uuid references public.alma_v2_observations(id),
  is_canonical boolean not null default true,
  schema_version integer not null default 2 check (schema_version >= 2),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (occurred_end_at is null or occurred_at is null or occurred_end_at >= occurred_at)
);

create unique index if not exists alma_v2_observations_one_canonical_idx
  on public.alma_v2_observations (
    user_id,
    definition_id,
    local_date,
    coalesce(occurred_at, '-infinity'::timestamptz),
    coalesce(occurred_end_at, '-infinity'::timestamptz)
  )
  where is_canonical and deleted_at is null;

create unique index if not exists alma_v2_observations_source_record_idx
  on public.alma_v2_observations (user_id, source_id, source_record_id)
  where source_record_id is not null and deleted_at is null;

create table if not exists public.alma_v2_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_definition_id text not null check (char_length(entity_definition_id) between 1 and 160),
  local_date date not null,
  occurred_at timestamptz,
  occurred_end_at timestamptz,
  timezone text not null,
  time_precision text not null check (time_precision in ('date_only', 'day_part', 'approximate_time', 'exact_time')),
  presence text not null default 'present' check (presence in ('present', 'confirmed_absent', 'unknown')),
  quantity numeric,
  unit text,
  attributes jsonb not null default '{}'::jsonb,
  source_id text not null,
  source_record_id text,
  source_device_id text,
  adapter_version text,
  epistemic_status text not null check (epistemic_status in ('measured', 'user_confirmed', 'inferred')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  converted_from_planned_event_id uuid,
  schema_version integer not null default 2 check (schema_version >= 2),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (occurred_end_at is null or occurred_at is null or occurred_end_at >= occurred_at)
);

create table if not exists public.alma_v2_symptom_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_definition_id text not null check (char_length(entity_definition_id) between 1 and 160),
  local_date date not null,
  occurred_at timestamptz,
  occurred_end_at timestamptz,
  timezone text not null,
  time_precision text not null check (time_precision in ('date_only', 'day_part', 'approximate_time', 'exact_time')),
  presence text not null check (presence in ('present', 'confirmed_absent', 'unknown')),
  intensity numeric(5,4) check (intensity between 0 and 1),
  location text,
  character text,
  duration_minutes integer check (duration_minutes >= 0),
  attributes jsonb not null default '{}'::jsonb,
  source_id text not null,
  source_record_id text,
  source_device_id text,
  adapter_version text,
  epistemic_status text not null check (epistemic_status in ('measured', 'user_confirmed', 'inferred')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  provenance_context text,
  schema_version integer not null default 2 check (schema_version >= 2),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (occurred_end_at is null or occurred_at is null or occurred_end_at >= occurred_at)
);

create unique index if not exists alma_v2_events_source_record_idx
  on public.alma_v2_events (user_id, source_id, source_record_id)
  where source_record_id is not null and deleted_at is null;

create unique index if not exists alma_v2_symptom_source_record_idx
  on public.alma_v2_symptom_episodes (user_id, source_id, source_record_id)
  where source_record_id is not null and deleted_at is null;

create table if not exists public.alma_v2_context_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_definition_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text not null,
  value jsonb,
  source_id text not null,
  epistemic_status text not null check (epistemic_status in ('measured', 'user_confirmed', 'inferred')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  schema_version integer not null default 2,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);

create table if not exists public.alma_v2_planned_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_definition_id text not null,
  planned_start_at timestamptz not null,
  planned_end_at timestamptz,
  local_date date not null,
  timezone text not null,
  status text not null default 'planned' check (status in ('planned', 'confirmed_happened', 'confirmed_cancelled', 'expired_unknown')),
  importance numeric(5,4) check (importance between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  source_id text not null,
  schema_version integer not null default 2,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (planned_end_at is null or planned_end_at >= planned_start_at)
);

alter table public.alma_v2_events
  drop constraint if exists alma_v2_events_converted_from_planned_event_id_fkey;
alter table public.alma_v2_events
  add constraint alma_v2_events_converted_from_planned_event_id_fkey
  foreign key (converted_from_planned_event_id) references public.alma_v2_planned_events(id);

create table if not exists public.alma_v2_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  definition_id text not null,
  kind text not null check (kind in ('population_reference', 'habitual', 'user_declared', 'comfortable')),
  value numeric not null,
  unit text,
  valid_from date not null,
  valid_to date,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  algorithm_version text not null,
  user_confirmed boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (valid_to is null or valid_to >= valid_from)
);

create table if not exists public.alma_v2_dynamic_features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  definition_id text not null,
  local_date date not null,
  feature_type text not null check (feature_type in ('normalized_value', 'deviation_from_baseline', 'delta', 'slope', 'direction', 'velocity', 'volatility', 'duration', 'cumulative_change', 'streak', 'threshold_crossing')),
  value numeric not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  based_on_observation_ids uuid[] not null default '{}',
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, definition_id, local_date, feature_type, algorithm_version)
);

create table if not exists public.alma_v2_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_definition_id text not null,
  factor_definition_ids text[] not null,
  modifier_definition_ids text[] not null default '{}',
  relationship_type text not null check (relationship_type in ('association', 'inverse', 'lagged', 'cumulative', 'threshold', 'interaction', 'compensation', 'mediated')),
  direction text check (direction in ('up_up', 'up_down', 'down_up', 'down_down')),
  typical_lag_minutes integer,
  lag_range_minutes int4range,
  cumulative_window_days integer,
  threshold numeric,
  evidence_score numeric(6,5) not null check (evidence_score between 0 and 1),
  stage text not null check (stage in ('observation', 'possible_link', 'repeating_pattern', 'established_personal_pattern')),
  lifecycle text not null check (lifecycle in ('emerged', 'stable', 'strengthening', 'weakening', 'changed', 'no_longer_observed', 'refined')),
  evidence jsonb not null default '[]'::jsonb,
  parent_pattern_id uuid references public.alma_v2_patterns(id),
  valid_from date not null,
  valid_to date,
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_research_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  target_definition_id text not null,
  status text not null check (status in ('suggested', 'active', 'paused', 'sufficient_result', 'completed', 'background_monitoring', 'reactivated')),
  hypotheses jsonb not null default '[]'::jsonb,
  required_metric_ids text[] not null default '{}',
  optional_metric_ids text[] not null default '{}',
  progress jsonb not null default '{}'::jsonb,
  dossier jsonb not null default '{}'::jsonb,
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_input_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_definition_id text not null,
  reason_code text not null,
  related_quest_id uuid references public.alma_v2_research_quests(id),
  related_hypothesis_id text,
  priority numeric(8,5) not null,
  information_value numeric(5,4) not null check (information_value between 0 and 1),
  estimated_effort numeric(5,4) not null check (estimated_effort between 0 and 1),
  recurring boolean not null default false,
  expires_at timestamptz,
  retrospective_allowed boolean not null default false,
  explanation text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'expired', 'dismissed')),
  answer_observation_id uuid references public.alma_v2_observations(id),
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_output_feed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_type text not null,
  structured_payload jsonb not null,
  title text not null,
  body text not null,
  relevant_period_start timestamptz,
  relevant_period_end timestamptz,
  priority numeric(8,5) not null default 0,
  read_at timestamptz,
  archived_at timestamptz,
  carry_forward boolean not null default true,
  related_pattern_id uuid references public.alma_v2_patterns(id),
  related_quest_id uuid references public.alma_v2_research_quests(id),
  supersedes_insight_id uuid references public.alma_v2_output_feed(id),
  source_data_deleted_at timestamptz,
  algorithm_version text not null,
  narrative_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_definition_id text not null,
  generated_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  probability numeric(5,4) not null check (probability between 0 and 1),
  predicted_value numeric,
  uncertainty numeric(5,4) check (uncertainty between 0 and 1),
  positive_contributor_ids text[] not null default '{}',
  negative_contributor_ids text[] not null default '{}',
  compensator_ids text[] not null default '{}',
  related_pattern_ids uuid[] not null default '{}',
  outcome text not null default 'pending' check (outcome in ('pending', 'confirmed_occurred', 'confirmed_absent', 'unknown')),
  resolved_at timestamptz,
  brier_score numeric(7,6) check (brier_score between 0 and 1),
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (window_end >= window_start)
);

create table if not exists public.alma_v2_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_definition_id text not null,
  action_definition_id text not null,
  related_pattern_ids uuid[] not null default '{}',
  expected_benefit numeric(5,4) check (expected_benefit between 0 and 1),
  controllability numeric(5,4) check (controllability between 0 and 1),
  effort numeric(5,4) check (effort between 0 and 1),
  risk numeric(5,4) check (risk between 0 and 1),
  status text not null default 'generated' check (status in ('generated', 'shown', 'opened', 'accepted', 'performed', 'not_performed', 'helped', 'did_not_help')),
  shown_at timestamptz,
  performed_event_id uuid references public.alma_v2_events(id),
  non_medical boolean not null default true,
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_personal_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_definition_id text not null,
  action_definition_id text not null,
  context_filter jsonb not null default '{}'::jsonb,
  test_count integer not null default 0 check (test_count >= 0),
  consistency numeric(5,4) not null default 0 check (consistency between 0 and 1),
  status text not null default 'candidate' check (status in ('candidate', 'active', 'weakening', 'retired')),
  related_pattern_ids uuid[] not null default '{}',
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.alma_v2_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hypothesis jsonb not null,
  intervention jsonb not null,
  target_definition_id text not null,
  period_start date not null,
  period_end date not null,
  baseline_window daterange not null,
  observation_window daterange not null,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'completed', 'cancelled')),
  result jsonb,
  evidence jsonb not null default '[]'::jsonb,
  algorithm_version text not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (period_end >= period_start)
);

create table if not exists public.alma_v2_sync_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  record_type text not null,
  local_version integer not null check (local_version >= 1),
  server_version integer check (server_version >= 1),
  sync_state text not null check (sync_state in ('local_only', 'pending', 'synced', 'conflict', 'deleted_pending')),
  conflict_reason text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, record_type, record_id)
);

create table if not exists public.alma_v2_legacy_unclassified (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_table text not null,
  legacy_record_id text not null,
  local_date date,
  raw_payload jsonb not null,
  reason text not null,
  resolved_entity_definition_id text,
  resolved_record_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, legacy_table, legacy_record_id)
);

create index if not exists alma_v2_observations_user_date_idx on public.alma_v2_observations (user_id, local_date desc) where deleted_at is null;
create index if not exists alma_v2_observations_definition_date_idx on public.alma_v2_observations (user_id, definition_id, local_date desc) where is_canonical and deleted_at is null;
create index if not exists alma_v2_events_user_date_idx on public.alma_v2_events (user_id, local_date desc) where deleted_at is null;
create index if not exists alma_v2_events_entity_date_idx on public.alma_v2_events (user_id, entity_definition_id, local_date desc) where deleted_at is null;
create index if not exists alma_v2_symptom_entity_date_idx on public.alma_v2_symptom_episodes (user_id, entity_definition_id, local_date desc) where deleted_at is null;
create index if not exists alma_v2_context_time_idx on public.alma_v2_context_periods (user_id, started_at desc) where deleted_at is null;
create index if not exists alma_v2_planned_date_idx on public.alma_v2_planned_events (user_id, local_date) where deleted_at is null;
create index if not exists alma_v2_baseline_definition_idx on public.alma_v2_baselines (user_id, definition_id, valid_from desc) where deleted_at is null;
create index if not exists alma_v2_patterns_target_idx on public.alma_v2_patterns (user_id, target_definition_id, stage) where deleted_at is null;
create index if not exists alma_v2_quests_status_idx on public.alma_v2_research_quests (user_id, status, updated_at desc) where deleted_at is null;
create index if not exists alma_v2_requests_queue_idx on public.alma_v2_input_requests (user_id, status, priority desc) where deleted_at is null;
create index if not exists alma_v2_feed_unread_idx on public.alma_v2_output_feed (user_id, read_at, priority desc, created_at desc) where deleted_at is null;
create index if not exists alma_v2_forecasts_pending_idx on public.alma_v2_forecasts (user_id, outcome, window_end) where deleted_at is null;
create index if not exists alma_v2_recommendations_status_idx on public.alma_v2_recommendations (user_id, status, created_at desc) where deleted_at is null;

create or replace function public.alma_v2_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.version <= old.version then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.alma_v2_touch_updated_at() from public, anon, authenticated;

create or replace function public.alma_v2_protect_output_feed_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.user_id,
    new.insight_type,
    new.structured_payload,
    new.title,
    new.body,
    new.relevant_period_start,
    new.relevant_period_end,
    new.related_pattern_id,
    new.related_quest_id,
    new.supersedes_insight_id,
    new.algorithm_version,
    new.narrative_version,
    new.created_at
  ) is distinct from row(
    old.user_id,
    old.insight_type,
    old.structured_payload,
    old.title,
    old.body,
    old.relevant_period_start,
    old.relevant_period_end,
    old.related_pattern_id,
    old.related_quest_id,
    old.supersedes_insight_id,
    old.algorithm_version,
    old.narrative_version,
    old.created_at
  ) then
    raise exception 'ALMA output feed content is immutable; create a superseding insight instead';
  end if;
  return new;
end;
$$;

revoke all on function public.alma_v2_protect_output_feed_content() from public, anon, authenticated;

drop trigger if exists alma_v2_output_feed_protect_content on public.alma_v2_output_feed;
create trigger alma_v2_output_feed_protect_content
before update on public.alma_v2_output_feed
for each row execute function public.alma_v2_protect_output_feed_content();

do $$
declare
  table_name text;
  mutable_tables text[] := array[
    'alma_v2_profiles', 'alma_v2_entities', 'alma_v2_entity_aliases', 'alma_v2_observations',
    'alma_v2_events', 'alma_v2_symptom_episodes', 'alma_v2_context_periods', 'alma_v2_planned_events',
    'alma_v2_baselines', 'alma_v2_dynamic_features', 'alma_v2_patterns', 'alma_v2_research_quests',
    'alma_v2_input_requests', 'alma_v2_output_feed', 'alma_v2_forecasts', 'alma_v2_recommendations',
    'alma_v2_personal_tools', 'alma_v2_experiments'
  ];
begin
  foreach table_name in array mutable_tables loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.alma_v2_touch_updated_at()',
      table_name || '_touch_updated_at', table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
  alma_tables text[] := array[
    'alma_v2_profiles', 'alma_v2_entities', 'alma_v2_entity_aliases', 'alma_v2_observations',
    'alma_v2_events', 'alma_v2_symptom_episodes', 'alma_v2_context_periods', 'alma_v2_planned_events',
    'alma_v2_baselines', 'alma_v2_dynamic_features', 'alma_v2_patterns', 'alma_v2_research_quests',
    'alma_v2_input_requests', 'alma_v2_output_feed', 'alma_v2_forecasts', 'alma_v2_recommendations',
    'alma_v2_personal_tools', 'alma_v2_experiments', 'alma_v2_sync_state', 'alma_v2_legacy_unclassified'
  ];
begin
  foreach table_name in array alma_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id) with check ((select auth.uid()) is not null and (select auth.uid()) = user_id)',
      table_name || '_owner_all', table_name
    );
  end loop;
end $$;

-- Compatibility copy: profile facts and preferences are retained.
insert into public.alma_v2_profiles (user_id, display_name, timezone, preferences, version, created_at, updated_at)
select
  user_id,
  display_name,
  timezone,
  jsonb_build_object(
    'locationName', location_name,
    'cycleLength', cycle_length,
    'periodLength', period_length,
    'lastPeriodStart', last_period_start,
    'automaticHighlights', automatic_highlights
  ),
  1,
  created_at,
  updated_at
from public.alma_profiles
on conflict (user_id) do nothing;

-- Legacy signed load is safely retained as subjective response only.
-- No load intensity is invented. Synthetic source='seed' rows are excluded.
insert into public.alma_v2_observations (
  id, user_id, definition_id, local_date, timezone, time_precision, recorded_at, value, raw_value,
  unit, source_id, source_record_id, epistemic_status, presence, confidence, metadata,
  is_canonical, schema_version, version, created_at, updated_at
)
select
  gen_random_uuid(),
  state.user_id,
  definition.definition_id,
  state.observed_on,
  coalesce(profile.timezone, 'UTC'),
  'date_only',
  state.created_at,
  to_jsonb((definition.raw_value / 100.0)::numeric),
  to_jsonb(definition.raw_value),
  'ratio',
  'legacy_cloud',
  state.id::text || ':' || definition.definition_id,
  case when state.source = 'check_in' then 'user_confirmed' else 'inferred' end,
  'present',
  case when state.source = 'check_in' then 1 else 0.35 end,
  jsonb_build_object('legacyTable', 'alma_daily_states', 'legacySource', state.source, 'legacyNote', state.note),
  true,
  2,
  1,
  state.created_at,
  state.updated_at
from public.alma_daily_states state
left join public.alma_profiles profile on profile.user_id = state.user_id
cross join lateral (
  values
    ('cognitive_load_response', state.cognitive),
    ('emotional_load_response', state.emotional),
    ('physical_load_response', state.physical),
    ('social_load_response', state.social),
    ('libido', state.libido)
) as definition(definition_id, raw_value)
where state.source <> 'seed'
on conflict do nothing;

-- Confirmed legacy symptom rows become presence-only episodes. Old default
-- intensity is preserved as raw metadata, never asserted as a new fact.
insert into public.alma_v2_symptom_episodes (
  id, user_id, entity_definition_id, local_date, timezone, time_precision, presence,
  attributes, source_id, source_record_id, epistemic_status, confidence, provenance_context,
  schema_version, version, created_at, updated_at
)
select
  gen_random_uuid(),
  symptom.user_id,
  symptom.symptom_key,
  symptom.observed_on,
  coalesce(profile.timezone, 'UTC'),
  'date_only',
  'present',
  jsonb_build_object('legacyLabel', symptom.label, 'legacyIntensity', symptom.intensity, 'intensityMigratedAsFact', false),
  'legacy_cloud',
  symptom.id::text,
  'user_confirmed',
  0.85,
  symptom.zone,
  2,
  1,
  symptom.created_at,
  symptom.updated_at
from public.alma_symptom_entries symptom
left join public.alma_profiles profile on profile.user_id = symptom.user_id
where symptom.status = 'confirmed'
  and symptom.zone <> 'general'
on conflict do nothing;

-- A small explicit mapping is safe because these labels were action buttons in
-- the old UI. Everything else remains unclassified instead of being guessed.
insert into public.alma_v2_events (
  id, user_id, entity_definition_id, local_date, timezone, time_precision, presence,
  attributes, source_id, source_record_id, epistemic_status, confidence,
  schema_version, version, created_at, updated_at
)
select
  gen_random_uuid(),
  entry.user_id,
  action.definition_id,
  entry.observed_on,
  coalesce(profile.timezone, 'UTC'),
  'date_only',
  'present',
  jsonb_build_object('legacyLabel', entry.label),
  'legacy_cloud',
  entry.id::text,
  'user_confirmed',
  0.9,
  2,
  1,
  entry.created_at,
  entry.updated_at
from public.alma_symptom_entries entry
left join public.alma_profiles profile on profile.user_id = entry.user_id
join lateral (
  select case lower(entry.label)
    when 'тренировка' then 'workout'
    when 'йога' then 'yoga'
    when 'прогулка' then 'walking'
    when 'секс' then 'sex'
    when 'алкоголь' then 'alcohol'
    when 'кофе' then 'coffee'
    when 'контрацептив' then 'medication_intake'
    when 'приняла контрацептив' then 'medication_intake'
    when 'тест на овуляцию' then 'ovulation_test'
    when 'тест на беременность' then 'pregnancy_test'
    else null
  end as definition_id
) action on action.definition_id is not null
where entry.status = 'confirmed' and entry.zone = 'general'
on conflict do nothing;

insert into public.alma_v2_legacy_unclassified (
  user_id, legacy_table, legacy_record_id, local_date, raw_payload, reason
)
select
  entry.user_id,
  'alma_symptom_entries',
  entry.id::text,
  entry.observed_on,
  to_jsonb(entry),
  'Legacy zone=general was not an explicitly mapped action; user confirmation is required.'
from public.alma_symptom_entries entry
where entry.zone = 'general'
  and lower(entry.label) not in ('тренировка', 'йога', 'прогулка', 'секс', 'алкоголь', 'кофе', 'контрацептив', 'приняла контрацептив', 'тест на овуляцию', 'тест на беременность')
on conflict (user_id, legacy_table, legacy_record_id) do nothing;

-- Biological facts and calculations remain epistemically distinct.
insert into public.alma_v2_events (
  id, user_id, entity_definition_id, local_date, timezone, time_precision, presence,
  attributes, source_id, source_record_id, epistemic_status, confidence,
  schema_version, version, created_at, updated_at
)
select
  gen_random_uuid(),
  cycle.user_id,
  case
    when cycle.event_type = 'menstruation' then 'menstruation'
    when cycle.event_type = 'cycle_start' then 'menstruation_start'
    when cycle.event_type = 'ovulation' and cycle.system_generated then 'estimated_ovulation'
    when cycle.event_type = 'ovulation' then 'ovulation_observation'
    when cycle.event_type = 'fertile' and cycle.system_generated then 'estimated_fertile_window'
    when cycle.event_type = 'fertile' then 'fertile_window_observation'
  end,
  cycle.observed_on,
  coalesce(profile.timezone, 'UTC'),
  'date_only',
  'present',
  jsonb_build_object('dayIndex', cycle.day_index, 'legacyIntensity', cycle.intensity, 'legacyNote', cycle.note),
  'legacy_cloud',
  cycle.id::text,
  case when cycle.system_generated then 'inferred' else 'user_confirmed' end,
  case when cycle.system_generated then 0.45 else 1 end,
  2,
  1,
  cycle.created_at,
  cycle.created_at
from public.alma_cycle_events cycle
left join public.alma_profiles profile on profile.user_id = cycle.user_id
where cycle.event_type <> 'custom'
on conflict do nothing;

insert into public.alma_v2_legacy_unclassified (
  user_id, legacy_table, legacy_record_id, local_date, raw_payload, reason
)
select
  cycle.user_id,
  'alma_cycle_events',
  cycle.id::text,
  cycle.observed_on,
  to_jsonb(cycle),
  'Legacy custom cycle event requires explicit classification.'
from public.alma_cycle_events cycle
where cycle.event_type = 'custom'
on conflict (user_id, legacy_table, legacy_record_id) do nothing;

-- Real environmental API snapshots become measured observations. Raw units are preserved.
insert into public.alma_v2_observations (
  id, user_id, definition_id, occurred_at, local_date, timezone, time_precision, recorded_at,
  value, raw_value, unit, source_id, source_record_id, epistemic_status, presence, confidence,
  metadata, is_canonical, schema_version, version, created_at, updated_at
)
select
  gen_random_uuid(), snapshot.user_id, signal.definition_id, snapshot.observed_at, snapshot.observed_on,
  coalesce(profile.timezone, 'UTC'), 'exact_time', snapshot.created_at,
  to_jsonb(signal.value), to_jsonb(signal.value), signal.unit, signal.source_id,
  snapshot.id::text || ':' || signal.definition_id, 'measured', 'present', 0.9,
  jsonb_build_object('locationName', snapshot.location_name, 'latitude', snapshot.latitude, 'longitude', snapshot.longitude, 'sources', snapshot.sources),
  true, 2, 1, snapshot.created_at, snapshot.created_at
from public.alma_environment_snapshots snapshot
left join public.alma_profiles profile on profile.user_id = snapshot.user_id
cross join lateral (
  values
    ('temperature', snapshot.temperature_c, '°C', 'open_meteo'),
    ('humidity', snapshot.humidity_pct::numeric, '%', 'open_meteo'),
    ('pressure', snapshot.pressure_hpa, 'hPa', 'open_meteo'),
    ('wind', snapshot.wind_kph, 'km/h', 'open_meteo'),
    ('daylight', snapshot.daylight_minutes::numeric, 'min', 'open_meteo'),
    ('geomagnetic_kp', snapshot.geomagnetic_kp, 'Kp', 'noaa_swpc')
) signal(definition_id, value, unit, source_id)
where signal.value is not null
on conflict do nothing;

comment on table public.alma_v2_observations is 'Canonical ALMA observations. Source, epistemic status and presence are independent.';
comment on table public.alma_v2_events is 'Canonical factual or planned events. Events are never stored as symptoms.';
comment on table public.alma_v2_symptom_episodes is 'Symptom episodes with optional depth. Missing intensity is unknown, never zero.';
comment on table public.alma_v2_output_feed is 'Immutable personal news stream. Later refinements create linked new records.';
comment on table public.alma_v2_legacy_unclassified is 'Ambiguous legacy records retained for explicit safe classification.';
