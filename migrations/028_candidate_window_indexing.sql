alter table tron_address_usdt_index_states
  add column if not exists request_kind text not null default 'broad_targeted',
  add column if not exists window_start_timestamp_ms bigint not null default 0,
  add column if not exists window_start_timestamp timestamptz,
  add column if not exists window_end_timestamp_ms bigint not null default 0,
  add column if not exists window_end_timestamp timestamptz,
  add column if not exists related_hop_tx_hash text,
  add column if not exists candidate_tx_hash text;

update tron_address_usdt_index_states
set request_kind = 'broad_targeted',
  window_start_timestamp_ms = case when coverage_mode = 'targeted' then 0 else 0 end,
  window_start_timestamp = null,
  window_end_timestamp_ms = target_timestamp_ms,
  window_end_timestamp = target_timestamp
where request_kind = 'broad_targeted'
  and window_end_timestamp_ms = 0;

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_request_kind_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_request_kind_check
  check (request_kind in ('broad_targeted', 'candidate_window'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_window_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_window_check
  check (
    request_kind = 'broad_targeted'
    or (
      coverage_mode = 'targeted'
      and window_start_timestamp_ms > 0
      and window_end_timestamp_ms > 0
      and window_start_timestamp is not null
      and window_end_timestamp is not null
      and window_start_timestamp_ms <= window_end_timestamp_ms
      and window_end_timestamp_ms = target_timestamp_ms
      and candidate_tx_hash is not null
      and length(candidate_tx_hash) > 0
    )
  );

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_pkey;

alter table tron_address_usdt_index_states
  add primary key (
    address,
    token_contract,
    coverage_mode,
    target_timestamp_ms,
    request_kind,
    window_start_timestamp_ms,
    candidate_tx_hash
  );

drop index if exists tron_address_usdt_index_states_queue_idx;
create index if not exists tron_address_usdt_index_states_queue_idx
  on tron_address_usdt_index_states(coverage_mode, request_kind, status, priority desc, next_run_at, created_at);

drop index if exists tron_address_usdt_index_states_lock_idx;
create index if not exists tron_address_usdt_index_states_lock_idx
  on tron_address_usdt_index_states(coverage_mode, request_kind, status, locked_until, heartbeat_at);

alter table forensic_job_waits
  add column if not exists request_kind text not null default 'broad_targeted',
  add column if not exists window_start_timestamp_ms bigint not null default 0,
  add column if not exists window_start_timestamp timestamptz,
  add column if not exists window_end_timestamp_ms bigint not null default 0,
  add column if not exists window_end_timestamp timestamptz,
  add column if not exists related_hop_tx_hash text,
  add column if not exists candidate_tx_hash text;

update forensic_job_waits
set request_kind = 'broad_targeted',
  window_end_timestamp_ms = target_timestamp_ms,
  window_end_timestamp = target_timestamp
where request_kind = 'broad_targeted'
  and window_end_timestamp_ms = 0;

alter table forensic_job_waits drop constraint if exists forensic_job_waits_request_kind_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_request_kind_check
  check (request_kind in ('broad_targeted', 'candidate_window'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_window_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_window_check
  check (
    request_kind = 'broad_targeted'
    or (
      window_start_timestamp_ms > 0
      and window_end_timestamp_ms > 0
      and window_start_timestamp is not null
      and window_end_timestamp is not null
      and window_start_timestamp_ms <= window_end_timestamp_ms
      and window_end_timestamp_ms = target_timestamp_ms
      and candidate_tx_hash is not null
      and length(candidate_tx_hash) > 0
    )
  );

alter table forensic_job_waits drop constraint if exists forensic_job_waits_job_id_wait_type_address_coverage_mode_target_timestamp_ms_key;

alter table forensic_job_waits
  add constraint forensic_job_waits_identity_unique unique (
    job_id,
    wait_type,
    address,
    coverage_mode,
    target_timestamp_ms,
    request_kind,
    window_start_timestamp_ms,
    candidate_tx_hash
  );

drop index if exists forensic_job_waits_target_idx;
create index if not exists forensic_job_waits_target_idx
  on forensic_job_waits(wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, status);
