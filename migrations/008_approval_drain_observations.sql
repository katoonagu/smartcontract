create table if not exists observed_approval_drain_events (
  id text primary key,
  watched_wallet_id text not null references watched_wallets(id) on delete cascade,
  approval_tx_hash text not null,
  transfer_tx_hash text not null,
  owner_address text not null,
  spender_address text not null,
  receiver_address text not null,
  token_contract text not null,
  amount_raw text not null,
  caller_address text not null,
  method text not null,
  approval_at timestamptz not null,
  transfer_at timestamptz not null,
  time_to_transfer_ms bigint not null,
  spender_type text not null default 'unknown',
  receiver_type text not null default 'unknown',
  observed_mode text not null default 'shadow',
  risk_level text not null,
  risk_score integer not null,
  risk_reasons jsonb not null default '[]'::jsonb,
  raw_evidence_id text references raw_evidence(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (approval_tx_hash, watched_wallet_id, transfer_tx_hash, spender_address, receiver_address)
);

alter table observed_approval_drain_events drop constraint if exists observed_approval_drain_events_spender_type_check;
alter table observed_approval_drain_events
  add constraint observed_approval_drain_events_spender_type_check
  check (spender_type in ('eoa', 'contract', 'unknown'));

alter table observed_approval_drain_events drop constraint if exists observed_approval_drain_events_receiver_type_check;
alter table observed_approval_drain_events
  add constraint observed_approval_drain_events_receiver_type_check
  check (receiver_type in ('eoa', 'contract', 'unknown'));

alter table observed_approval_drain_events drop constraint if exists observed_approval_drain_events_observed_mode_check;
alter table observed_approval_drain_events
  add constraint observed_approval_drain_events_observed_mode_check
  check (observed_mode in ('shadow'));

alter table observed_approval_drain_events drop constraint if exists observed_approval_drain_events_risk_level_check;
alter table observed_approval_drain_events
  add constraint observed_approval_drain_events_risk_level_check
  check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_drain_events_risk_score_check'
  ) then
    alter table observed_approval_drain_events
      add constraint observed_approval_drain_events_risk_score_check
      check (risk_score >= 0 and risk_score <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'observed_approval_drain_events_time_to_transfer_check'
  ) then
    alter table observed_approval_drain_events
      add constraint observed_approval_drain_events_time_to_transfer_check
      check (time_to_transfer_ms >= 0);
  end if;
end $$;

create index if not exists observed_approval_drain_events_wallet_idx
  on observed_approval_drain_events(watched_wallet_id, transfer_at desc);

create index if not exists observed_approval_drain_events_spender_idx
  on observed_approval_drain_events(spender_address, transfer_at desc);

create index if not exists observed_approval_drain_events_approval_idx
  on observed_approval_drain_events(approval_tx_hash);
