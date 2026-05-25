create table if not exists tron_usdt_transfers (
  tx_hash text not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  event_index integer not null,
  from_address text not null,
  to_address text not null,
  amount_raw text not null,
  method text not null,
  caller_address text,
  contract_ret text,
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tx_hash, event_index)
);

alter table tron_usdt_transfers drop constraint if exists tron_usdt_transfers_method_check;
alter table tron_usdt_transfers
  add constraint tron_usdt_transfers_method_check
  check (method in ('transfer', 'transferFrom'));

alter table tron_usdt_transfers drop constraint if exists tron_usdt_transfers_amount_raw_check;
alter table tron_usdt_transfers
  add constraint tron_usdt_transfers_amount_raw_check
  check (amount_raw ~ '^[0-9]+$');

create index if not exists tron_usdt_transfers_from_timestamp_idx
  on tron_usdt_transfers(from_address, block_timestamp desc);

create index if not exists tron_usdt_transfers_to_timestamp_idx
  on tron_usdt_transfers(to_address, block_timestamp desc);

create index if not exists tron_usdt_transfers_tx_hash_idx
  on tron_usdt_transfers(tx_hash);

create index if not exists tron_usdt_transfers_block_idx
  on tron_usdt_transfers(block_number, event_index);

create table if not exists tron_usdt_approvals (
  tx_hash text not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  event_index integer not null,
  owner_address text not null,
  spender_address text not null,
  amount_raw text not null,
  is_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tx_hash, event_index)
);

alter table tron_usdt_approvals drop constraint if exists tron_usdt_approvals_amount_raw_check;
alter table tron_usdt_approvals
  add constraint tron_usdt_approvals_amount_raw_check
  check (amount_raw ~ '^[0-9]+$');

create index if not exists tron_usdt_approvals_owner_spender_timestamp_idx
  on tron_usdt_approvals(owner_address, spender_address, block_timestamp desc);

create index if not exists tron_usdt_approvals_tx_hash_idx
  on tron_usdt_approvals(tx_hash);

create table if not exists address_features_daily (
  address text not null,
  day date not null,
  in_volume_raw numeric(78, 0) not null default 0,
  out_volume_raw numeric(78, 0) not null default 0,
  in_count integer not null default 0,
  out_count integer not null default 0,
  unique_in integer not null default 0,
  unique_out integer not null default 0,
  first_seen timestamptz,
  last_seen timestamptz,
  updated_at timestamptz not null default now(),
  primary key (address, day)
);

create index if not exists address_features_daily_address_day_idx
  on address_features_daily(address, day desc);

create table if not exists address_labels_cache (
  chain text not null default 'tron',
  address text not null,
  provider text not null,
  label text not null,
  category text not null,
  confidence text not null,
  source_url text,
  raw_json jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain, address, provider, label)
);

alter table address_labels_cache drop constraint if exists address_labels_cache_provider_check;
alter table address_labels_cache
  add constraint address_labels_cache_provider_check
  check (provider in ('tronscan', 'oklink', 'arkham', 'manual'));

alter table address_labels_cache drop constraint if exists address_labels_cache_category_check;
alter table address_labels_cache
  add constraint address_labels_cache_category_check
  check (category in ('cex', 'hot_wallet', 'bridge', 'router', 'dex', 'pool', 'scam', 'darknet_exchange', 'unknown'));

alter table address_labels_cache drop constraint if exists address_labels_cache_confidence_check;
alter table address_labels_cache
  add constraint address_labels_cache_confidence_check
  check (confidence in ('low', 'medium', 'high'));

create index if not exists address_labels_cache_address_idx
  on address_labels_cache(chain, address, last_seen_at desc);

create index if not exists address_labels_cache_category_idx
  on address_labels_cache(category, last_seen_at desc);

create table if not exists tron_usdt_indexer_cursors (
  id text primary key,
  status text not null,
  last_indexed_block bigint,
  last_indexed_timestamp timestamptz,
  last_fingerprint text,
  progress_json jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tron_usdt_indexer_cursors drop constraint if exists tron_usdt_indexer_cursors_status_check;
alter table tron_usdt_indexer_cursors
  add constraint tron_usdt_indexer_cursors_status_check
  check (status in ('idle', 'running', 'completed', 'failed'));
