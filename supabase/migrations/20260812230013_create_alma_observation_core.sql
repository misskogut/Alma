create table if not exists public.alma_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Вы',
  timezone text not null default 'Europe/Saratov',
  location_name text not null default 'Энгельс',
  latitude numeric(8,5) not null default 51.48550 check (latitude between -90 and 90),
  longitude numeric(8,5) not null default 46.12680 check (longitude between -180 and 180),
  cycle_length smallint not null default 28 check (cycle_length between 21 and 45),
  period_length smallint not null default 5 check (period_length between 1 and 10),
  last_period_start date,
  automatic_highlights boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alma_daily_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_on date not null,
  cognitive smallint not null default 0 check (cognitive between -100 and 100),
  emotional smallint not null default 0 check (emotional between -100 and 100),
  physical smallint not null default 0 check (physical between -100 and 100),
  libido smallint not null default 0 check (libido between -100 and 100),
  social smallint not null default 0 check (social between -100 and 100),
  note text check (char_length(note) <= 1000),
  source text not null default 'check_in' check (source in ('check_in', 'seed', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, observed_on)
);

create table if not exists public.alma_symptom_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_on date not null,
  symptom_key text not null check (char_length(symptom_key) between 1 and 80),
  label text not null check (char_length(label) between 1 and 120),
  zone text not null default 'general' check (zone in ('cognitive', 'emotional', 'physical', 'libido', 'social', 'general')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed')),
  intensity smallint not null default 40 check (intensity between 0 and 100),
  suggested_by text not null default 'system' check (suggested_by in ('system', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, observed_on, symptom_key)
);

create table if not exists public.alma_cycle_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_on date not null,
  event_type text not null check (event_type in ('menstruation', 'fertile', 'ovulation', 'cycle_start', 'custom')),
  day_index smallint check (day_index between 1 and 60),
  intensity smallint check (intensity between 0 and 100),
  system_generated boolean not null default false,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, observed_on, event_type)
);

create table if not exists public.alma_environment_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_on date not null,
  observed_at timestamptz not null,
  latitude numeric(8,5) not null check (latitude between -90 and 90),
  longitude numeric(8,5) not null check (longitude between -180 and 180),
  location_name text,
  temperature_c numeric(5,2),
  humidity_pct smallint check (humidity_pct between 0 and 100),
  pressure_hpa numeric(7,2),
  wind_kph numeric(6,2),
  weather_code smallint,
  daylight_minutes smallint check (daylight_minutes between 0 and 1440),
  geomagnetic_kp numeric(4,2) check (geomagnetic_kp between 0 and 9),
  sources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, observed_on, latitude, longitude)
);

create table if not exists public.alma_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_on date not null,
  insight_key text not null check (char_length(insight_key) between 1 and 120),
  kind text not null check (kind in ('match', 'divergence', 'pattern', 'forecast')),
  repetition_count smallint not null default 1 check (repetition_count between 1 and 1000),
  confidence text not null default 'quiet' check (confidence in ('hidden', 'quiet', 'visible')),
  body text not null check (char_length(body) between 1 and 500),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, observed_on, insight_key)
);

create index if not exists alma_daily_states_user_date_idx on public.alma_daily_states (user_id, observed_on desc);
create index if not exists alma_symptom_entries_user_date_idx on public.alma_symptom_entries (user_id, observed_on desc);
create index if not exists alma_symptom_entries_repeat_idx on public.alma_symptom_entries (user_id, symptom_key, status, observed_on desc);
create index if not exists alma_cycle_events_user_date_idx on public.alma_cycle_events (user_id, observed_on desc);
create index if not exists alma_environment_user_date_idx on public.alma_environment_snapshots (user_id, observed_on desc);
create index if not exists alma_insights_user_date_idx on public.alma_insights (user_id, observed_on desc);

alter table public.alma_profiles enable row level security;
alter table public.alma_daily_states enable row level security;
alter table public.alma_symptom_entries enable row level security;
alter table public.alma_cycle_events enable row level security;
alter table public.alma_environment_snapshots enable row level security;
alter table public.alma_insights enable row level security;

revoke all on public.alma_profiles from anon;
revoke all on public.alma_daily_states from anon;
revoke all on public.alma_symptom_entries from anon;
revoke all on public.alma_cycle_events from anon;
revoke all on public.alma_environment_snapshots from anon;
revoke all on public.alma_insights from anon;

grant select, insert, update, delete on public.alma_profiles to authenticated;
grant select, insert, update, delete on public.alma_daily_states to authenticated;
grant select, insert, update, delete on public.alma_symptom_entries to authenticated;
grant select, insert, update, delete on public.alma_cycle_events to authenticated;
grant select, insert, update, delete on public.alma_environment_snapshots to authenticated;
grant select, insert, update, delete on public.alma_insights to authenticated;

create policy "alma_profiles_owner_all" on public.alma_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alma_daily_states_owner_all" on public.alma_daily_states for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alma_symptom_entries_owner_all" on public.alma_symptom_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alma_cycle_events_owner_all" on public.alma_cycle_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alma_environment_owner_all" on public.alma_environment_snapshots for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alma_insights_owner_all" on public.alma_insights for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

comment on table public.alma_daily_states is 'ALMA subjective observations. External context is deliberately stored separately.';
comment on table public.alma_environment_snapshots is 'ALMA external context snapshots; never used as the source of the subjective integral wave.';
