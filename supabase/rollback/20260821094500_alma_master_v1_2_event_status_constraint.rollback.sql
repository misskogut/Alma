alter table public.alma_v2_events
  drop constraint if exists alma_v2_events_epistemic_status_check;

alter table public.alma_v2_events
  add constraint alma_v2_events_epistemic_status_check
  check (epistemic_status in ('measured', 'user_confirmed', 'inferred', 'planned'));
