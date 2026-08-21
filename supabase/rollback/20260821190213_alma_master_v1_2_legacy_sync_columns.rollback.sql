drop index if exists public.alma_v2_legacy_unclassified_pending_idx;
drop index if exists public.alma_v2_legacy_unclassified_sync_idx;

drop trigger if exists alma_v2_legacy_unclassified_touch_updated_at
  on public.alma_v2_legacy_unclassified;

alter table public.alma_v2_legacy_unclassified
  drop constraint if exists alma_v2_legacy_unclassified_status_check,
  drop constraint if exists alma_v2_legacy_unclassified_version_check,
  drop constraint if exists alma_v2_legacy_unclassified_schema_version_check,
  drop column if exists deleted_at,
  drop column if exists updated_at,
  drop column if exists version,
  drop column if exists schema_version,
  drop column if exists classification_status,
  drop column if exists legacy_source;
