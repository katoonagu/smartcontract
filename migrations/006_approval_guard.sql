create table if not exists wallet_approval_poll_state (
  watched_wallet_id text primary key references watched_wallets(id) on delete cascade,
  last_seen_approval_ts timestamptz,
  last_seen_tx_hash text,
  last_successful_poll_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists wallet_approvals (
  watched_wallet_id text not null references watched_wallets(id) on delete cascade,
  token_contract text not null,
  spender_address text not null,
  amount_raw text not null,
  is_unlimited boolean not null default false,
  current_allowance_raw text not null,
  spender_type text not null default 'unknown',
  status text not null default 'active',
  last_approval_tx_hash text,
  last_approval_at timestamptz,
  risk_level text not null default 'LOW',
  risk_score integer not null default 0,
  risk_reasons jsonb not null default '[]'::jsonb,
  last_alerted_tx_hash text,
  updated_at timestamptz not null default now(),
  primary key (watched_wallet_id, token_contract, spender_address)
);

alter table wallet_approvals drop constraint if exists wallet_approvals_spender_type_check;
alter table wallet_approvals
  add constraint wallet_approvals_spender_type_check
  check (spender_type in ('eoa', 'contract', 'unknown'));

alter table wallet_approvals drop constraint if exists wallet_approvals_status_check;
alter table wallet_approvals
  add constraint wallet_approvals_status_check
  check (status in ('active', 'revoked', 'unknown'));

alter table wallet_approvals drop constraint if exists wallet_approvals_risk_level_check;
alter table wallet_approvals
  add constraint wallet_approvals_risk_level_check
  check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_approvals_risk_score_check'
  ) then
    alter table wallet_approvals
      add constraint wallet_approvals_risk_score_check
      check (risk_score >= 0 and risk_score <= 100);
  end if;
end $$;

create table if not exists observed_approval_events (
  approval_tx_hash text not null,
  watched_wallet_id text not null references watched_wallets(id) on delete cascade,
  owner_address text not null,
  token_contract text not null,
  spender_address text not null,
  spender_type text not null default 'unknown',
  amount_raw text not null,
  is_unlimited boolean not null default false,
  approval_at timestamptz not null,
  owner_alert_status text not null default 'pending',
  owner_alert_attempts integer not null default 0,
  owner_alert_last_error text,
  owner_alert_updated_at timestamptz,
  risk_level text,
  risk_score integer,
  risk_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (approval_tx_hash, watched_wallet_id, owner_address, token_contract, spender_address)
);

alter table observed_approval_events drop constraint if exists observed_approval_events_spender_type_check;
alter table observed_approval_events
  add constraint observed_approval_events_spender_type_check
  check (spender_type in ('eoa', 'contract', 'unknown'));

alter table observed_approval_events drop constraint if exists observed_approval_events_owner_alert_status_check;
alter table observed_approval_events
  add constraint observed_approval_events_owner_alert_status_check
  check (owner_alert_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

alter table observed_approval_events drop constraint if exists observed_approval_events_risk_level_check;
alter table observed_approval_events
  add constraint observed_approval_events_risk_level_check
  check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_events_owner_alert_attempts_check'
  ) then
    alter table observed_approval_events
      add constraint observed_approval_events_owner_alert_attempts_check
      check (owner_alert_attempts >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_events_risk_score_check'
  ) then
    alter table observed_approval_events
      add constraint observed_approval_events_risk_score_check
      check (risk_score is null or (risk_score >= 0 and risk_score <= 100));
  end if;
end $$;

create index if not exists wallet_approvals_risk_idx
  on wallet_approvals(watched_wallet_id, risk_score desc, updated_at desc);

create index if not exists observed_approval_events_status_idx
  on observed_approval_events(owner_alert_status, owner_alert_updated_at);
