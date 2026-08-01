alter table watched_wallets
  add column if not exists alert_mode text not null default 'realtime',
  add column if not exists digest_interval_minutes integer not null default 10;

alter table watched_wallets drop constraint if exists watched_wallets_alert_mode_check;
alter table watched_wallets
  add constraint watched_wallets_alert_mode_check
  check (alert_mode in ('realtime', 'risk_only', 'digest', 'paused'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'watched_wallets_digest_interval_minutes_check'
  ) then
    alter table watched_wallets
      add constraint watched_wallets_digest_interval_minutes_check
      check (digest_interval_minutes between 5 and 60);
  end if;
end $$;

alter table observed_transactions
  add column if not exists risk_level text,
  add column if not exists risk_score integer,
  add column if not exists risk_reasons jsonb not null default '[]'::jsonb,
  add column if not exists digest_sent_at timestamptz;

alter table observed_transactions drop constraint if exists observed_transactions_user_alert_status_check;
alter table observed_transactions
  add constraint observed_transactions_user_alert_status_check
  check (user_alert_status in ('pending', 'sending', 'analyzing', 'sent', 'failed', 'skipped'));

alter table observed_transactions drop constraint if exists observed_transactions_risk_level_check;
alter table observed_transactions
  add constraint observed_transactions_risk_level_check
  check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'observed_transactions_risk_score_check'
  ) then
    alter table observed_transactions
      add constraint observed_transactions_risk_score_check
      check (risk_score is null or (risk_score >= 0 and risk_score <= 100));
  end if;
end $$;

create index if not exists observed_transactions_digest_due_idx
  on observed_transactions(watched_wallet_id, digest_sent_at, created_at)
  where digest_sent_at is null;
