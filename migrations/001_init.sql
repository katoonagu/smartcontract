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
  created_at timestamptz not null default now(),
  primary key (tx_hash, watched_wallet_id)
);

create table if not exists address_labels (
  address text not null,
  label text not null check (label in ('scam', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract')),
  source text not null check (source in ('service_admin', 'system')),
  created_by_telegram_id text,
  created_at timestamptz not null default now(),
  primary key (address, label)
);

create table if not exists transaction_labels (
  tx_hash text not null,
  label text not null check (label in ('scam', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract')),
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
create index if not exists address_labels_address_idx on address_labels(address);
