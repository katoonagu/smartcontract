create table if not exists telegram_user_sessions (
  telegram_user_id text primary key references telegram_users(telegram_user_id) on delete cascade,
  pending_action text,
  selected_wallet_id text references watched_wallets(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table telegram_user_sessions
  add column if not exists pending_action text,
  add column if not exists selected_wallet_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
alter table telegram_user_sessions
  add constraint telegram_user_sessions_pending_action_check
  check (pending_action is null or pending_action in ('add_wallet', 'check_address', 'check_tx'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'telegram_user_sessions_selected_wallet_id_fkey'
  ) then
    alter table telegram_user_sessions
      add constraint telegram_user_sessions_selected_wallet_id_fkey
      foreign key (selected_wallet_id) references watched_wallets(id) on delete set null;
  end if;
end $$;

alter table wallet_poll_state
  add column if not exists last_poll_event_count integer not null default 0,
  add column if not exists last_poll_new_count integer not null default 0,
  add column if not exists last_poll_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_poll_state_last_poll_event_count_check'
  ) then
    alter table wallet_poll_state
      add constraint wallet_poll_state_last_poll_event_count_check
      check (last_poll_event_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wallet_poll_state_last_poll_new_count_check'
  ) then
    alter table wallet_poll_state
      add constraint wallet_poll_state_last_poll_new_count_check
      check (last_poll_new_count >= 0);
  end if;
end $$;

create table if not exists wallet_dashboard_snapshots (
  watched_wallet_id text primary key references watched_wallets(id) on delete cascade,
  trx_balance_sun numeric(38,0) not null default 0,
  usdt_balance_micro numeric(38,0) not null default 0,
  wallet_created_at timestamptz,
  total_tx_count numeric(38,0),
  incoming_tx_count numeric(38,0),
  outgoing_tx_count numeric(38,0),
  thirty_day_in_usdt numeric(38,6) not null default 0,
  thirty_day_out_usdt numeric(38,6) not null default 0,
  thirty_day_transfer_count integer not null default 0,
  thirty_day_fee_sun numeric(38,0) not null default 0,
  trx_usd_price numeric(18,8),
  analytics_partial boolean not null default false,
  refreshed_at timestamptz not null default now(),
  last_error text
);

alter table wallet_dashboard_snapshots
  add column if not exists trx_balance_sun numeric(38,0) not null default 0,
  add column if not exists usdt_balance_micro numeric(38,0) not null default 0,
  add column if not exists wallet_created_at timestamptz,
  add column if not exists total_tx_count numeric(38,0),
  add column if not exists incoming_tx_count numeric(38,0),
  add column if not exists outgoing_tx_count numeric(38,0),
  add column if not exists thirty_day_in_usdt numeric(38,6) not null default 0,
  add column if not exists thirty_day_out_usdt numeric(38,6) not null default 0,
  add column if not exists thirty_day_transfer_count integer not null default 0,
  add column if not exists thirty_day_fee_sun numeric(38,0) not null default 0,
  add column if not exists trx_usd_price numeric(18,8),
  add column if not exists analytics_partial boolean not null default false,
  add column if not exists refreshed_at timestamptz not null default now(),
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_dashboard_snapshots_total_tx_count_check'
  ) then
    alter table wallet_dashboard_snapshots
      add constraint wallet_dashboard_snapshots_total_tx_count_check
      check (total_tx_count is null or total_tx_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wallet_dashboard_snapshots_incoming_tx_count_check'
  ) then
    alter table wallet_dashboard_snapshots
      add constraint wallet_dashboard_snapshots_incoming_tx_count_check
      check (incoming_tx_count is null or incoming_tx_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wallet_dashboard_snapshots_outgoing_tx_count_check'
  ) then
    alter table wallet_dashboard_snapshots
      add constraint wallet_dashboard_snapshots_outgoing_tx_count_check
      check (outgoing_tx_count is null or outgoing_tx_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wallet_dashboard_snapshots_thirty_day_transfer_count_check'
  ) then
    alter table wallet_dashboard_snapshots
      add constraint wallet_dashboard_snapshots_thirty_day_transfer_count_check
      check (thirty_day_transfer_count >= 0);
  end if;
end $$;

alter table wallet_dashboard_snapshots
  alter column total_tx_count type numeric(38,0) using total_tx_count::numeric(38,0),
  alter column incoming_tx_count type numeric(38,0) using incoming_tx_count::numeric(38,0),
  alter column outgoing_tx_count type numeric(38,0) using outgoing_tx_count::numeric(38,0);
