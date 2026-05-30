create table if not exists telegram_users (
  telegram_user_id text primary key,
  username text,
  created_at timestamptz not null default now()
);

create table if not exists watched_wallets (
  id text primary key,
  telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
  address text not null,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, address)
);

create table if not exists observed_transactions (
  tx_hash text not null,
  watched_wallet_id text not null references watched_wallets(id) on delete cascade,
  sender text not null,
  receiver text not null,
  token text not null check (token in ('USDT')),
  amount text not null,
  timestamp timestamptz not null,
  user_alert_status text not null default 'pending' check (user_alert_status in ('pending', 'sending', 'sent', 'failed')),
  user_alert_attempts integer not null default 0 check (user_alert_attempts >= 0),
  user_alert_last_error text,
  user_alert_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tx_hash, watched_wallet_id)
);

alter table observed_transactions
  add column if not exists user_alert_status text not null default 'pending',
  add column if not exists user_alert_attempts integer not null default 0,
  add column if not exists user_alert_last_error text,
  add column if not exists user_alert_updated_at timestamptz;

alter table observed_transactions drop constraint if exists observed_transactions_user_alert_status_check;
alter table observed_transactions
  add constraint observed_transactions_user_alert_status_check
  check (user_alert_status in ('pending', 'sending', 'sent', 'failed'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'observed_transactions_user_alert_attempts_check'
  ) then
    alter table observed_transactions
      add constraint observed_transactions_user_alert_attempts_check
      check (user_alert_attempts >= 0);
  end if;
end $$;

create table if not exists wallet_poll_state (
  watched_wallet_id text primary key references watched_wallets(id) on delete cascade,
  last_seen_block_ts timestamptz,
  last_seen_tx_hash text,
  backfill_anchor_block_ts timestamptz,
  backfill_anchor_tx_hash text,
  backfill_next_start integer not null default 0 check (backfill_next_start >= 0),
  backfill_complete boolean not null default false,
  last_successful_poll_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table wallet_poll_state
  add column if not exists backfill_anchor_block_ts timestamptz,
  add column if not exists backfill_anchor_tx_hash text,
  add column if not exists backfill_next_start integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_poll_state_backfill_next_start_check'
  ) then
    alter table wallet_poll_state
      add constraint wallet_poll_state_backfill_next_start_check
      check (backfill_next_start >= 0);
  end if;
end $$;

create table if not exists address_labels (
  address text not null,
  label text not null check (label in ('scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity', 'approval_drain_proximity')),
  source text not null check (source in ('service_admin', 'system')),
  created_by_telegram_id text,
  created_at timestamptz not null default now(),
  primary key (address, label)
);

create table if not exists transaction_labels (
  tx_hash text not null,
  label text not null check (label in ('scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity', 'approval_drain_proximity')),
  source text not null check (source in ('service_admin', 'system')),
  created_by_telegram_id text,
  created_at timestamptz not null default now(),
  primary key (tx_hash, label)
);

create table if not exists risk_reports (
  id text primary key,
  tx_hash text,
  subject_address text not null,
  level text not null check (level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  score integer not null check (score >= 0 and score <= 100),
  reasons jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists watched_wallets_address_idx on watched_wallets(address);
create index if not exists observed_transactions_watched_wallet_id_idx on observed_transactions(watched_wallet_id);
create index if not exists observed_transactions_user_alert_status_idx on observed_transactions(user_alert_status);
create index if not exists address_labels_address_idx on address_labels(address);
