create table if not exists forensic_check_jobs (
  id text primary key,
  kind text not null,
  subject_address text not null,
  status text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  priority integer not null default 100,
  chat_id text,
  message_id text,
  requested_by text,
  progress_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  raw_evidence_ids jsonb not null default '[]'::jsonb,
  observation_ids jsonb not null default '[]'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_kind_check;
alter table forensic_check_jobs
  add constraint forensic_check_jobs_kind_check
  check (kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_status_check;
alter table forensic_check_jobs
  add constraint forensic_check_jobs_status_check
  check (status in ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled'));

create unique index if not exists forensic_check_jobs_active_unique_idx
  on forensic_check_jobs(kind, subject_address, window_start, window_end, coalesce(requested_by, ''))
  where status in ('queued', 'running');

create index if not exists forensic_check_jobs_claim_idx
  on forensic_check_jobs(status, priority desc, created_at asc)
  where status = 'queued';

create index if not exists forensic_check_jobs_subject_idx
  on forensic_check_jobs(subject_address, created_at desc);
