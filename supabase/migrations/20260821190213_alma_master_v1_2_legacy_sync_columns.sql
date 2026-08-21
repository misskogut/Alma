-- Make the ambiguity quarantine participate in the same versioned,
-- local-first sync contract as the rest of ALMA V1.2.

alter table public.alma_v2_legacy_unclassified
  add column if not exists legacy_source text,
  add column if not exists classification_status text,
  add column if not exists schema_version integer,
  add column if not exists version integer,
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

update public.alma_v2_legacy_unclassified
set
  legacy_source = coalesce(legacy_source, legacy_table),
  classification_status = coalesce(
    classification_status,
    case
      when resolved_at is not null
        or resolved_entity_definition_id is not null
        or resolved_record_id is not null
      then 'classified'
      else 'pending'
    end
  ),
  schema_version = coalesce(schema_version, 2),
  version = coalesce(version, 1),
  updated_at = coalesce(updated_at, resolved_at, created_at, now());

alter table public.alma_v2_legacy_unclassified
  alter column legacy_source set default 'legacy',
  alter column legacy_source set not null,
  alter column classification_status set default 'pending',
  alter column classification_status set not null,
  alter column schema_version set default 2,
  alter column schema_version set not null,
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alma_v2_legacy_unclassified_status_check'
      and conrelid = 'public.alma_v2_legacy_unclassified'::regclass
  ) then
    alter table public.alma_v2_legacy_unclassified
      add constraint alma_v2_legacy_unclassified_status_check
      check (classification_status in ('pending', 'classified', 'discarded'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'alma_v2_legacy_unclassified_version_check'
      and conrelid = 'public.alma_v2_legacy_unclassified'::regclass
  ) then
    alter table public.alma_v2_legacy_unclassified
      add constraint alma_v2_legacy_unclassified_version_check
      check (version >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'alma_v2_legacy_unclassified_schema_version_check'
      and conrelid = 'public.alma_v2_legacy_unclassified'::regclass
  ) then
    alter table public.alma_v2_legacy_unclassified
      add constraint alma_v2_legacy_unclassified_schema_version_check
      check (schema_version >= 2);
  end if;
end $$;

drop trigger if exists alma_v2_legacy_unclassified_touch_updated_at
  on public.alma_v2_legacy_unclassified;

create trigger alma_v2_legacy_unclassified_touch_updated_at
before update on public.alma_v2_legacy_unclassified
for each row execute function public.alma_v2_touch_updated_at();

create index if not exists alma_v2_legacy_unclassified_sync_idx
  on public.alma_v2_legacy_unclassified (user_id, updated_at)
  where deleted_at is null;

create index if not exists alma_v2_legacy_unclassified_pending_idx
  on public.alma_v2_legacy_unclassified (user_id, created_at desc)
  where classification_status = 'pending' and deleted_at is null;

comment on column public.alma_v2_legacy_unclassified.classification_status is
  'Explicit user-reviewed lifecycle; pending rows never participate in evidence.';
