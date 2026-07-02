alter table tron_usdt_transfers
  add column if not exists transfer_id text,
  add column if not exists provider text,
  add column if not exists provider_row_ordinal_in_tx integer,
  add column if not exists event_type text,
  add column if not exists final_result text,
  add column if not exists reverted boolean,
  add column if not exists risk_transaction boolean;

update tron_usdt_transfers
set transfer_id = 'legacy:' || tx_hash || ':' || event_index::text
where transfer_id is null;

update tron_usdt_transfers
set provider = 'tronscan'
where provider is null;

update tron_usdt_transfers
set provider_row_ordinal_in_tx = event_index
where provider_row_ordinal_in_tx is null;

update tron_usdt_transfers
set event_type = 'Transfer'
where event_type is null;

update tron_usdt_transfers
set final_result = contract_ret
where final_result is null;

update tron_usdt_transfers
set reverted = false
where reverted is null;

update tron_usdt_transfers
set risk_transaction = false
where risk_transaction is null;

alter table tron_usdt_transfers
  alter column transfer_id set not null,
  alter column provider set not null,
  alter column reverted set not null,
  alter column risk_transaction set not null;

alter table tron_usdt_transfers drop constraint if exists tron_usdt_transfers_pkey;

alter table tron_usdt_transfers drop constraint if exists tron_usdt_transfers_provider_check;
alter table tron_usdt_transfers
  add constraint tron_usdt_transfers_provider_check
  check (provider in ('tronscan', 'trongrid_fallback', 'mixed'));

alter table tron_usdt_transfers drop constraint if exists tron_usdt_transfers_transfer_id_unique;
alter table tron_usdt_transfers
  add constraint tron_usdt_transfers_transfer_id_unique unique (transfer_id);

create index if not exists tron_usdt_transfers_tx_event_idx
  on tron_usdt_transfers(tx_hash, event_index);

create table if not exists tron_address_usdt_index_states (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null default 'all_time',
  coverage_kind text not null default 'provider_windowed',
  target_timestamp_ms bigint not null default 0,
  target_timestamp timestamptz,
  status text not null,
  status_reason text,
  provider text,
  total_reported integer,
  fetched_transfer_count integer not null default 0,
  unique_counterparty_count integer not null default 0,
  newest_transfer_at timestamptz,
  oldest_transfer_at timestamptz,
  covered_until_timestamp timestamptz,
  fetched_page_count integer not null default 0,
  planned_page_count integer,
  current_end_timestamp timestamptz,
  provider_cap_hit boolean not null default false,
  budget_exhausted boolean not null default false,
  provider_inconsistent boolean not null default false,
  priority integer not null default 0,
  next_run_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  retry_count integer not null default 0,
  last_error text,
  last_error_class text,
  last_successful_page_at timestamptz,
  queued_reason text,
  requested_by_job_id text,
  locked_at timestamptz,
  locked_until timestamptz,
  heartbeat_at timestamptz,
  lock_owner text,
  budget_pages integer,
  budget_seconds integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms)
);

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_coverage_mode_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_coverage_mode_check
  check (coverage_mode in ('all_time', 'targeted'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_coverage_kind_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_coverage_kind_check
  check (coverage_kind in ('provider_windowed'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_target_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_target_check
  check (
    (coverage_mode = 'all_time' and target_timestamp_ms = 0 and target_timestamp is null)
    or
    (coverage_mode = 'targeted' and target_timestamp_ms > 0 and target_timestamp is not null)
  );

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_status_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_status_check
  check (status in ('queued', 'running', 'complete', 'partial', 'failed_retryable', 'failed_terminal'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_status_reason_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_status_reason_check
  check (status_reason is null or status_reason in (
    'complete_provider_windowed',
    'partial_provider_cap',
    'partial_budget_exhausted',
    'partial_rate_limited',
    'partial_provider_inconsistent',
    'too_large_deferred',
    'failed_retryable',
    'failed_terminal'
  ));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_provider_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_provider_check
  check (provider is null or provider in ('tronscan', 'trongrid_fallback', 'mixed'));

create index if not exists tron_address_usdt_index_states_queue_idx
  on tron_address_usdt_index_states(coverage_mode, status, priority desc, next_run_at, created_at);

create index if not exists tron_address_usdt_index_states_lock_idx
  on tron_address_usdt_index_states(coverage_mode, status, locked_until, heartbeat_at);

create table if not exists tron_address_usdt_coverage_intervals (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null,
  target_timestamp_ms bigint not null default 0,
  provider text not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz not null,
  status text not null,
  status_reason text not null,
  total_reported integer,
  range_total integer,
  pages_fetched integer not null default 0,
  rows_fetched integer not null default 0,
  unique_rows_inserted integer not null default 0,
  cap_hit boolean not null default false,
  provider_inconsistent boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms, provider, start_timestamp, end_timestamp)
);

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_coverage_mode_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_coverage_mode_check
  check (coverage_mode in ('all_time', 'targeted'));

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_target_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_target_check
  check (
    (coverage_mode = 'all_time' and target_timestamp_ms = 0)
    or
    (coverage_mode = 'targeted' and target_timestamp_ms > 0)
  );

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_provider_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_provider_check
  check (provider in ('tronscan', 'trongrid_fallback', 'mixed'));

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_status_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_status_check
  check (status in ('complete', 'partial'));

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_status_reason_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_status_reason_check
  check (status_reason in (
    'complete_provider_windowed',
    'partial_provider_cap',
    'partial_budget_exhausted',
    'partial_rate_limited',
    'partial_provider_inconsistent',
    'too_large_deferred',
    'failed_retryable',
    'failed_terminal'
  ));

alter table tron_address_usdt_coverage_intervals drop constraint if exists tron_address_usdt_coverage_intervals_range_check;
alter table tron_address_usdt_coverage_intervals
  add constraint tron_address_usdt_coverage_intervals_range_check
  check (start_timestamp <= end_timestamp);

create index if not exists tron_address_usdt_coverage_intervals_lookup_idx
  on tron_address_usdt_coverage_intervals(address, token_contract, coverage_mode, start_timestamp, end_timestamp);

create table if not exists tron_address_usdt_index_pages (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null default 'all_time',
  target_timestamp_ms bigint not null default 0,
  window_start_timestamp_ms bigint not null,
  window_end_timestamp_ms bigint not null,
  start_offset integer not null,
  limit_count integer not null,
  status text not null,
  transfer_count integer not null default 0,
  provider text,
  total_reported integer,
  range_total integer,
  raw_response_hash text,
  canonical_transfer_hash text,
  attempt_count integer not null default 0,
  error text,
  newest_transfer_at timestamptz,
  oldest_transfer_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, start_offset)
);

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_coverage_mode_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_coverage_mode_check
  check (coverage_mode in ('all_time', 'targeted'));

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_target_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_target_check
  check (
    (coverage_mode = 'all_time' and target_timestamp_ms = 0)
    or
    (coverage_mode = 'targeted' and target_timestamp_ms > 0)
  );

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_window_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_window_check
  check (window_start_timestamp_ms <= window_end_timestamp_ms and start_offset >= 0 and limit_count > 0);

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_status_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_status_check
  check (status in ('queued', 'running', 'complete', 'empty', 'failed'));

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_provider_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_provider_check
  check (provider is null or provider in ('tronscan', 'trongrid_fallback', 'mixed'));

create index if not exists tron_address_usdt_index_pages_address_status_idx
  on tron_address_usdt_index_pages(address, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, status, updated_at);
