-- Planned events live only in alma_v2_planned_events. Historical events may
-- be measured, confirmed by the user or inferred, but never merely planned.

alter table public.alma_v2_events
  drop constraint if exists alma_v2_events_epistemic_status_check;

alter table public.alma_v2_events
  add constraint alma_v2_events_epistemic_status_check
  check (epistemic_status in ('measured', 'user_confirmed', 'inferred'));
