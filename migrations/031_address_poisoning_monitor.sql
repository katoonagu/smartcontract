alter table observed_transactions
  add column if not exists poisoning_check_status text not null default 'skipped_backfill',
  add column if not exists poisoning_attempts integer not null default 0,
  add column if not exists poisoning_next_retry_at timestamptz,
  add column if not exists poisoning_logical_offset integer not null default 0,
  add column if not exists poisoning_page_count integer not null default 0,
  add column if not exists poisoning_fetched_count integer not null default 0,
  add column if not exists poisoning_oldest_fetched_at timestamptz,
  add column if not exists poisoning_lookup_coverage text,
  add column if not exists poisoning_accumulated_lookup_json jsonb not null default '{}'::jsonb,
  add column if not exists poisoning_last_error text,
  add column if not exists poisoning_updated_at timestamptz,
  add column if not exists poisoning_checked_at timestamptz;

alter table observed_transactions drop constraint if exists observed_transactions_poisoning_check_status_check;
alter table observed_transactions
  add constraint observed_transactions_poisoning_check_status_check
  check (poisoning_check_status in ('pending','running','inconclusive','clear','candidate','failed','skipped','skipped_backfill'));

alter table observed_transactions drop constraint if exists observed_transactions_poisoning_lookup_coverage_check;
alter table observed_transactions
  add constraint observed_transactions_poisoning_lookup_coverage_check
  check (poisoning_lookup_coverage is null or poisoning_lookup_coverage in ('complete','partial'));

alter table observed_transactions drop constraint if exists observed_transactions_poisoning_progress_check;
alter table observed_transactions
  add constraint observed_transactions_poisoning_progress_check
  check (
    poisoning_attempts >= 0
    and poisoning_logical_offset >= 0
    and poisoning_page_count >= 0
    and poisoning_fetched_count >= 0
  );

create index if not exists observed_transactions_poisoning_claim_idx
  on observed_transactions(poisoning_check_status, poisoning_next_retry_at, timestamp desc)
  where poisoning_check_status in ('pending', 'running', 'failed', 'inconclusive');

create table if not exists address_poisoning_candidates (
  id text primary key,
  callback_token text not null unique,
  watched_wallet_id text not null references watched_wallets(id) on delete cascade,
  token_contract text not null,
  token_symbol text not null,
  token_decimals integer not null,
  suspicious_incoming_tx_hash text not null,
  suspicious_sender text not null,
  suspicious_amount_raw numeric(78, 0) not null,
  suspicious_incoming_at timestamptz not null,
  matched_outgoing_tx_hash text not null,
  genuine_recipient text not null,
  matched_outgoing_amount_raw numeric(78, 0) not null,
  matched_outgoing_at timestamptz not null,
  raw_prefix_length integer not null,
  meaningful_prefix_length integer not null,
  suffix_length integer not null,
  classification text not null,
  confidence text not null,
  raw_evidence_id text not null references raw_evidence(id),
  secondary_matches_json jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  status text not null default 'candidate',
  alert_fingerprint text not null unique,
  alert_status text not null default 'pending',
  alert_attempts integer not null default 0,
  alert_next_retry_at timestamptz,
  alert_last_error text,
  telegram_chat_id text,
  telegram_message_id text,
  later_loss_tx_hash text,
  later_loss_evidence_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  alert_sent_at timestamptz,
  unique (watched_wallet_id, token_contract, suspicious_incoming_tx_hash)
);

alter table address_poisoning_candidates drop constraint if exists address_poisoning_candidates_classification_check;
alter table address_poisoning_candidates
  add constraint address_poisoning_candidates_classification_check
  check (classification in ('CRITICAL','HIGH'));

alter table address_poisoning_candidates drop constraint if exists address_poisoning_candidates_status_check;
alter table address_poisoning_candidates
  add constraint address_poisoning_candidates_status_check
  check (status in ('candidate','confirmed','dismissed'));

alter table address_poisoning_candidates drop constraint if exists address_poisoning_candidates_alert_status_check;
alter table address_poisoning_candidates
  add constraint address_poisoning_candidates_alert_status_check
  check (alert_status in ('pending','sending','sent','failed','skipped'));

alter table address_poisoning_candidates drop constraint if exists address_poisoning_candidates_progress_check;
alter table address_poisoning_candidates
  add constraint address_poisoning_candidates_progress_check
  check (
    token_decimals >= 0
    and suspicious_amount_raw >= 0
    and matched_outgoing_amount_raw >= 0
    and raw_prefix_length >= 0
    and meaningful_prefix_length >= 0
    and suffix_length >= 0
    and alert_attempts >= 0
  );

create index if not exists address_poisoning_candidates_active_idx
  on address_poisoning_candidates(watched_wallet_id, suspicious_incoming_at desc)
  where status <> 'dismissed';

create index if not exists address_poisoning_candidates_sender_idx
  on address_poisoning_candidates(suspicious_sender, suspicious_incoming_at desc);

create index if not exists address_poisoning_candidates_alert_delivery_idx
  on address_poisoning_candidates(alert_status, alert_next_retry_at, suspicious_incoming_at desc)
  where alert_status in ('pending', 'sending', 'failed');

alter table risk_signal_observations drop constraint if exists risk_signal_observations_group_check;
alter table risk_signal_observations
  add constraint risk_signal_observations_group_check
  check (signal_group in ('internal_label', 'provider', 'graph', 'behavior', 'incoming_context', 'approval', 'manual', 'wallet_safety'));

alter table risk_signal_observations drop constraint if exists risk_signal_observations_wallet_safety_zero_impact_check;
alter table risk_signal_observations
  add constraint risk_signal_observations_wallet_safety_zero_impact_check
  check (signal_group <> 'wallet_safety' or score_impact = 0);
