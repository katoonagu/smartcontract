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
  request_kind text not null default 'broad_targeted',
  window_start_timestamp_ms bigint not null default 0,
  window_start_timestamp timestamptz,
  window_end_timestamp_ms bigint not null default 0,
  window_end_timestamp timestamptz,
  related_hop_tx_hash text,
  candidate_tx_hash text not null default '',
  primary key (id)
);

alter table forensic_job_waits
  add column if not exists request_kind text not null default 'broad_targeted',
  add column if not exists window_start_timestamp_ms bigint not null default 0,
  add column if not exists window_start_timestamp timestamptz,
  add column if not exists window_end_timestamp_ms bigint not null default 0,
  add column if not exists window_end_timestamp timestamptz,
  add column if not exists related_hop_tx_hash text,
  add column if not exists candidate_tx_hash text not null default '';

update forensic_job_waits
set request_kind = 'broad_targeted',
  window_start_timestamp_ms = 0,
  window_start_timestamp = null,
  window_end_timestamp_ms = 0,
  window_end_timestamp = null,
  related_hop_tx_hash = null,
  candidate_tx_hash = ''
where request_kind is null
  or request_kind not in ('broad_targeted', 'candidate_window')
  or request_kind = 'broad_targeted'
  or (
    request_kind = 'candidate_window'
    and (
      window_start_timestamp_ms is null
      or window_start_timestamp_ms <= 0
      or window_end_timestamp_ms is null
      or window_end_timestamp_ms <= 0
      or candidate_tx_hash is null
      or candidate_tx_hash = ''
    )
  );

alter table forensic_job_waits drop constraint if exists forensic_job_waits_job_id_wait_type_address_coverage_mode_target_timestamp_ms_key;
alter table forensic_job_waits drop constraint if exists forensic_job_waits_identity_unique;
alter table forensic_job_waits
  add constraint forensic_job_waits_identity_unique
  unique (job_id, wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, candidate_tx_hash);

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

alter table forensic_job_waits drop constraint if exists forensic_job_waits_request_kind_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_request_kind_check
  check (request_kind in ('broad_targeted', 'candidate_window'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_window_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_window_check
  check (
    (request_kind = 'broad_targeted' and window_start_timestamp_ms = 0 and window_end_timestamp_ms = 0 and candidate_tx_hash = '')
    or
    (request_kind = 'candidate_window' and window_start_timestamp_ms > 0 and window_end_timestamp_ms > 0 and candidate_tx_hash <> '')
  );

drop index if exists forensic_job_waits_target_idx;
create index forensic_job_waits_target_idx
  on forensic_job_waits(wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, status);

create index if not exists forensic_job_waits_job_idx
  on forensic_job_waits(job_id, status);
