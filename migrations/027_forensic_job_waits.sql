create table if not exists forensic_job_waits (
  id text not null default md5(random()::text || clock_timestamp()::text),
  job_id text not null,
  wait_type text not null,
  address text not null,
  coverage_mode text not null default 'targeted',
  target_timestamp_ms bigint not null,
  target_timestamp timestamptz not null,
  required_for text not null,
  status text not null,
  status_reason text,
  last_error text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (job_id, wait_type, address, coverage_mode, target_timestamp_ms)
);

alter table forensic_job_waits drop constraint if exists forensic_job_waits_wait_type_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_wait_type_check
  check (wait_type in ('targeted_usdt_history'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_coverage_mode_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_coverage_mode_check
  check (coverage_mode in ('targeted'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_required_for_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_required_for_check
  check (required_for in ('where_hop', 'incoming_hop'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_status_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_status_check
  check (status in ('waiting', 'ready', 'terminal', 'cancelled'));

create index if not exists forensic_job_waits_target_idx
  on forensic_job_waits(wait_type, address, coverage_mode, target_timestamp_ms, status);

create index if not exists forensic_job_waits_job_idx
  on forensic_job_waits(job_id, status);
