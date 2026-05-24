alter table observed_approval_events
  add column if not exists context_status text not null default 'not_needed',
  add column if not exists context_deadline_at timestamptz,
  add column if not exists context_result text not null default 'unknown',
  add column if not exists initial_risk_level text,
  add column if not exists initial_risk_score integer,
  add column if not exists initial_risk_reasons jsonb not null default '[]'::jsonb,
  add column if not exists final_risk_level text,
  add column if not exists final_risk_score integer,
  add column if not exists final_risk_reasons jsonb not null default '[]'::jsonb,
  add column if not exists final_context_alert_sent_at timestamptz,
  add column if not exists context_last_error text,
  add column if not exists context_updated_at timestamptz not null default now();

alter table observed_approval_events drop constraint if exists observed_approval_events_context_status_check;
alter table observed_approval_events
  add constraint observed_approval_events_context_status_check
  check (context_status in ('not_needed', 'pending', 'finalizing', 'resolved', 'expired'));

alter table observed_approval_events drop constraint if exists observed_approval_events_context_result_check;
alter table observed_approval_events
  add constraint observed_approval_events_context_result_check
  check (context_result in ('linked_swap_route', 'no_route_found', 'collector_drain', 'unknown'));

alter table observed_approval_events drop constraint if exists observed_approval_events_initial_risk_level_check;
alter table observed_approval_events
  add constraint observed_approval_events_initial_risk_level_check
  check (initial_risk_level is null or initial_risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

alter table observed_approval_events drop constraint if exists observed_approval_events_final_risk_level_check;
alter table observed_approval_events
  add constraint observed_approval_events_final_risk_level_check
  check (final_risk_level is null or final_risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_events_initial_risk_score_check'
  ) then
    alter table observed_approval_events
      add constraint observed_approval_events_initial_risk_score_check
      check (initial_risk_score is null or (initial_risk_score >= 0 and initial_risk_score <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_events_final_risk_score_check'
  ) then
    alter table observed_approval_events
      add constraint observed_approval_events_final_risk_score_check
      check (final_risk_score is null or (final_risk_score >= 0 and final_risk_score <= 100));
  end if;
end $$;

create index if not exists observed_approval_events_context_due_idx
  on observed_approval_events(context_status, context_deadline_at)
  where context_status in ('pending', 'finalizing');
